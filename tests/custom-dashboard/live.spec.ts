import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { defaultDashboardTemplate, validateDashboardTemplate } from "../../shared/custom-dashboard-template";
import { dashboardRange, generateCustomDashboardData, boundedBody } from "../../apps/api/src/services/cf-custom-dashboard";
import { handleFetchCustomDashboard } from "../../apps/api/src/routes/fetch-custom-dashboard";
import { handleCreateSchedule, handleUpdateSchedule } from "../../apps/api/src/routes/schedules";
import { runSchedule } from "../../apps/api/src/scheduler";
import { renderDashboardPdf } from "../../apps/api/src/services/dashboard-pdf";
import { handleAuditGet } from "../../apps/api/src/routes/audit";
import puppeteer from "@cloudflare/puppeteer";

const ACCOUNT = "0".repeat(32), ZONE = "1".repeat(32), TOKEN = "synthetic-analytics-token";
const input = () => ({ token: TOKEN, accountId: ACCOUNT, zoneId: ZONE, zoneName: "example.com", template: defaultDashboardTemplate(), days: 1, tzOffset: -420 });
const result = (rows: unknown[]) => Response.json({ data: { viewer: { zones: [{ rows }] } } });

test("allowlisted analytics use variables, bounded concurrency, explicit coverage and credential-free output", async () => {
  const original = globalThis.fetch, calls: { query: string; variables: { filter: Record<string, string> } }[] = [];
  let concurrent = 0, max = 0;
  globalThis.fetch = async (url, init) => {
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    const body = JSON.parse(String(init?.body)); calls.push(body); concurrent++; max = Math.max(max, concurrent);
    await new Promise(r => setTimeout(r, 5)); concurrent--;
    if (body.query.includes("firewallEvents")) return Response.json({ errors: [{ message: `private upstream detail ${TOKEN}` }] });
    if (body.query.includes("clientCountryName")) return result([{ count: null, dimensions: { clientCountryName: "TH" } }, { count: 0, dimensions: { clientCountryName: "SG" } }]);
    return result([{ count: 5, sum: { edgeResponseBytes: 100 }, dimensions: { datetimeHour: "2026-09-01T00:00:00Z", clientRequestPath: "/booking" } }]);
  };
  try {
    const params = input(); params.template.hostname = "example.com"; params.template.path = '/booking?filter="quoted"';
    const data = await generateCustomDashboardData(params);
    expect(calls).toHaveLength(6); expect(max).toBe(3);
    expect(calls.every(c => c.variables.filter.clientRequestHTTPHost === "example.com" && c.variables.filter.clientRequestPath === params.template.path)).toBe(true);
    expect(calls.every(c => !c.query.includes("example.com") && !c.query.includes("quoted"))).toBe(true);
    expect(data.origin).toBe("api"); expect(data.widgets[2].rows).toEqual([]);
    expect(data.widgets[4].rows.map(r => r.count)).toEqual([null, 0]);
    expect(data.warnings.join(" ")).toContain("not zero");
    expect(JSON.stringify(data)).not.toContain(TOKEN); expect(JSON.stringify(data)).not.toContain("private upstream detail");
    expect(data.widgets[1].unit).toBe("bytes");
  } finally { globalThis.fetch = original; }
});

test("fresh execution windows move with the clock and retain local timezone boundaries", () => {
  const now = Date.now;
  try {
    Date.now = () => Date.parse("2026-09-03T03:00:00Z");
    const first = dashboardRange({ ...input(), rangeMode: "period", period: "yesterday" });
    Date.now = () => Date.parse("2026-09-04T03:00:00Z");
    const next = dashboardRange({ ...input(), rangeMode: "period", period: "yesterday" });
    expect(first.sinceTs).toBe("2026-09-01T17:00:00.000Z");
    expect(next.sinceTs).toBe("2026-09-02T17:00:00.000Z");
    expect(Date.parse(next.untilTs) - Date.parse(first.untilTs)).toBe(86400000);
  } finally { Date.now = now; }
});

test("template and route reject injected schema fields and invalid ranges before calling upstream", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error("Unexpected upstream call"); };
  const app = new Hono(); app.post("/api/custom-dashboard", handleFetchCustomDashboard);
  try {
    const template = defaultDashboardTemplate();
    for (const patch of [{ dataset: "__proto__" }, { metric: "count } malicious" }, { dimension: "secretField" }, { dimension: "clientCountryName", type: "stat" }]) {
      expect(() => validateDashboardTemplate({ ...template, widgets: [{ ...template.widgets[0], ...patch }] })).toThrow();
    }
    for (const body of [null, [], {}, { ...input(), tzOffset: "-420" }, { ...input(), days: 999 }, { ...input(), rangeMode: "unknown" }, { ...input(), template: { ...template, widgets: [] } }]) {
      const response = await app.request("/api/custom-dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
  } finally { globalThis.fetch = original; }
});

test("all-failed queries fail the report and oversized bodies are bounded", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ errors: [{ message: TOKEN }] });
  try { await expect(generateCustomDashboardData(input())).rejects.toThrow("All dashboard queries failed"); }
  finally { globalThis.fetch = original; }
  await expect(boundedBody(new Response("too large"), 3)).rejects.toThrow("size limit");
});

function database(before15 = false) {
  const db = new DatabaseSync(":memory:"); db.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(resolve("migrations")).filter(n => n.endsWith(".sql") && (!before15 || n < "0015")).sort()) db.exec(readFileSync(resolve("migrations", name), "utf8"));
  return db;
}
function binding(db: DatabaseSync) {
  return { prepare: (sql: string) => {
    const statement = (...args: (string | number | null)[]) => ({
      run: async () => { const info = db.prepare(sql).run(...args); return { meta: { changes: Number(info.changes) } }; },
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
    });
    return { ...statement(), bind: statement };
  } };
}

test("migration preserves old fields/history and template CRUD retains write-only credentials", async () => {
  const db = database(true), env = { DB: binding(db) }, app = new Hono();
  app.post("/api/schedules", handleCreateSchedule); app.put("/api/schedules/:id", handleUpdateSchedule);
  const base = { name: "Synthetic schedule", reportType: "appsec", zoneId: ZONE, zoneName: "example.com", days: 1, frequency: "daily", sendHourUtc: 2, tzOffset: -420, recipients: ["recipient@example.com"], subject: "Dashboard {{zone}}", apiToken: TOKEN, accountId: ACCOUNT };
  const request = (body: unknown, path = "/api/schedules", method = "POST") => app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  try {
    // The old schema intentionally lacks dashboard_template, so insert directly.
    db.exec(`INSERT INTO schedules(id,name,report_type,zone_id,zone_name,days,tz_offset,frequency,day_of_week,day_of_month,send_hour_utc,recipients,subject,message,is_poc,client_name,enabled,created_at,updated_at,last_run_at,last_status,last_error,range_mode,since_date,until_date,since_time,until_time,months_ago,period,api_token,account_id,client_logo)
      VALUES('old','Existing','appsec','${ZONE}','example.com',7,-420,'weekly',1,15,2,'["recipient@example.com"]','Existing','Existing message',0,'Synthetic customer',1,'2026-09-01','2026-09-02','2026-09-03','success','Prior error','period','2026-09-01','2026-09-02','09:30','10:45',1,'last_week','${TOKEN}','${ACCOUNT}','data:image/png;base64,example');
      INSERT INTO send_history(id,schedule_id,started_at,status,recipients) VALUES('old-history','old','2026-09-01','success','[]');`);
    const before = db.prepare("SELECT * FROM schedules").all(), history = db.prepare("SELECT * FROM send_history").all();
    const others = db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE '%schedules%' ORDER BY name").all();
    db.exec(readFileSync(resolve("migrations/0015_custom_dashboard_report.sql"), "utf8"));
    const after = db.prepare("SELECT * FROM schedules").all().map(({ dashboard_template, ...row }) => { expect(dashboard_template).toBeNull(); return row; });
    expect(after).toEqual(before); expect(db.prepare("SELECT * FROM send_history").all()).toEqual(history);
    expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE '%schedules%' ORDER BY name").all()).toEqual(others);
    const body = { ...base, reportType: "custom-dashboard", dashboardTemplate: defaultDashboardTemplate() };
    const created = await request(body); expect(created.status).toBe(201);
    const json = await created.json(); expect(json.schedule.dashboardTemplate).toEqual(body.dashboardTemplate);
    expect(JSON.stringify(json)).not.toContain(TOKEN);
    const { apiToken: _token, ...edit } = body;
    const edited = await request({ ...edit, enabled: false }, `/api/schedules/${json.schedule.id}`, "PUT"); expect(edited.status).toBe(200);
    const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(json.schedule.id)!;
    expect(row.api_token).toBe(TOKEN); expect(row.account_id).toBe(ACCOUNT); expect(JSON.parse(String(row.dashboard_template))).toEqual(body.dashboardTemplate);
    expect((await request({ ...body, dashboardTemplate: null })).status).toBe(400);
    expect((await request({ ...body, zoneId: null })).status).toBe(400);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { db.close(); }
});

test("scheduled run queries anew, renders PDF without customer credentials, attaches both artifacts and records failures", async () => {
  const db = database(), original = globalThis.fetch, sends: Record<string, unknown>[] = [], archives: string[] = [];
  let analytics = 0, pdfFailed = false, pdfRequests = 0;
  const template = defaultDashboardTemplate();
  const env = { DB: binding(db), CF_API_TOKEN: "synthetic-backend-token", CF_ACCOUNT_ID: "2".repeat(32), EMAIL_FROM: "reports@example.com",
    PDF_API_TOKEN: "synthetic-renderer-token", PDF_ACCOUNT_ID: "3".repeat(32),
    ASSETS: { fetch: async (req: Request) => new Response(req.url.endsWith(".js") ? `const root=1;${" ".repeat(11000)}` : "body{}") },
    EMAIL: { send: async (payload: Record<string, unknown>) => { sends.push(payload); return { messageId: "synthetic-message" }; } },
    AUDIT_BUCKET: { put: async (key: string) => { archives.push(key); } },
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/graphql")) { analytics++; expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`); return result([{ count: analytics, sum: { edgeResponseBytes: 100 } }]); }
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${env.PDF_ACCOUNT_ID}/browser-run/pdf`); pdfRequests++;
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${env.PDF_API_TOKEN}`);
    expect(body.url).toBeUndefined(); expect(body.html).toContain('"kind":"custom-dashboard"'); expect(body.html).not.toContain(TOKEN); expect(body.html).not.toContain(env.PDF_API_TOKEN);
    expect(body.rejectRequestPattern).toEqual([".*"]); expect(body.waitForSelector.selector).toBe(".cd-report .cd-widget");
    return pdfFailed ? new Response("private failure", { status: 503 }) : new Response("%PDF-1.7 synthetic transport test");
  };
  try {
    db.prepare(`INSERT INTO schedules(id,name,report_type,zone_id,zone_name,days,tz_offset,frequency,recipients,subject,created_at,updated_at,api_token,account_id,dashboard_template,range_mode,period) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("scheduled", "Synthetic dashboard", "custom-dashboard", ZONE, "example.com", 1, -420, "daily", '["recipient@example.com"]', "Dashboard {{zone}}", "2026-09-01", "2026-09-01", TOKEN, ACCOUNT, JSON.stringify(template), "period", "yesterday");
    const row = () => db.prepare("SELECT * FROM schedules WHERE id='scheduled'").get()!;
    for (let i = 0; i < 2; i++) expect((await runSchedule(env as never, row() as never, "cron")).ok).toBe(true);
    expect(analytics).toBe(12); expect(pdfRequests).toBe(2); expect(sends).toHaveLength(2); expect(archives).toHaveLength(6);
    const attachments = sends[0].attachments as { type: string; content: string | Uint8Array }[];
    expect(attachments.map(a => a.type)).toEqual(["application/pdf", "text/html"]);
    expect(attachments[0].content).toBeInstanceOf(Uint8Array);
    expect(String(attachments[1].content)).toContain("Content-Security-Policy");
    expect(String(attachments[1].content)).not.toBe(String((sends[1].attachments as typeof attachments)[1].content));
    expect(sends[0].subject).toContain("example.com");
    pdfFailed = true;
    const failed = await runSchedule(env as never, row() as never, "cron"); expect(failed.ok).toBe(false); expect(failed.error).toContain("HTTP 503");
    expect(sends).toHaveLength(2);
    expect(db.prepare("SELECT status FROM send_history ORDER BY rowid").all().map(r => r.status)).toEqual(["success", "success", "error"]);
    expect(db.prepare("SELECT last_status FROM schedules WHERE id='scheduled'").get()!.last_status).toBe("error");
    expect(JSON.stringify(db.prepare("SELECT * FROM send_history").all())).not.toContain(TOKEN);
  } finally { globalThis.fetch = original; db.close(); }
});

test("PDF setup and binary validation fail explicitly without a blank attachment", async () => {
  await expect(renderDashboardPdf({} as never, "report")).rejects.toThrow("PDF_API_TOKEN");
  const original = globalThis.fetch; globalThis.fetch = async () => new Response("not a PDF");
  try { await expect(renderDashboardPdf({ PDF_API_TOKEN: "synthetic-renderer-token", PDF_ACCOUNT_ID: ACCOUNT } as never, "report")).rejects.toThrow("invalid document"); }
  finally { globalThis.fetch = original; }
});

test("archived dashboard PDFs retain binary bytes and PDF content type", async () => {
  const app = new Hono(); app.get("/api/audit/*", handleAuditGet);
  const response = await app.request("/api/audit/scheduled/example/full.pdf", {}, { AUDIT_BUCKET: {
    get: async (key: string) => { expect(key).toBe("scheduled/example/full.pdf"); return { body: new TextEncoder().encode("%PDF-1.7 synthetic archive"), httpMetadata: { contentType: "application/pdf" } }; },
  } });
  expect(response.headers.get("content-type")).toBe("application/pdf");
  expect(await response.text()).toBe("%PDF-1.7 synthetic archive");
});

test("browser-binding PDF rendering needs no API token, blocks requests and closes sessions on success or failure", async () => {
  const launch = puppeteer.launch, calls: string[] = [], binding = {};
  let fail = false;
  puppeteer.launch = async browserBinding => {
    expect(browserBinding).toBe(binding);
    return { close: async () => { calls.push("close"); }, newPage: async () => ({
      setRequestInterception: async (enabled: boolean) => { expect(enabled).toBe(true); calls.push("intercept"); },
      on: (event: string, handler: (request: { abort: () => Promise<void> }) => void) => { expect(event).toBe("request"); handler({ abort: async () => { calls.push("abort"); } }); },
      emulateMediaType: async (media: string) => { expect(media).toBe("print"); },
      setContent: async (html: string) => { expect(html).toContain("synthetic report"); if (fail) throw new Error("Synthetic browser failure"); },
      waitForSelector: async (selector: string) => { expect(selector).toBe(".cd-report .cd-widget"); },
      pdf: async () => new TextEncoder().encode("%PDF-1.7 synthetic binding test"),
    }) } as never;
  };
  try {
    expect(new TextDecoder().decode(await renderDashboardPdf({ BROWSER: binding } as never, "synthetic report"))).toContain("%PDF-");
    fail = true; await expect(renderDashboardPdf({ BROWSER: binding } as never, "synthetic report")).rejects.toThrow("Synthetic browser failure");
    expect(calls.filter(c => c === "close")).toHaveLength(2); expect(calls.filter(c => c === "abort")).toHaveLength(2);
  } finally { puppeteer.launch = launch; }
});
