import { test, expect } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { handleCreateSchedule, handleUpdateSchedule } from "../../apps/api/src/routes/schedules";

test("migration preserves every existing schedule column, history, indexes and unrelated tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const files = readdirSync(resolve("migrations")).filter(n => n.endsWith(".sql")).sort();
    for (const name of files.filter(n => n < "0014")) db.exec(readFileSync(resolve("migrations", name), "utf8"));
    db.exec(`INSERT INTO schedules (id,name,report_type,zone_id,zone_name,days,tz_offset,frequency,day_of_week,day_of_month,send_hour_utc,recipients,subject,message,is_poc,client_name,enabled,created_at,updated_at,last_run_at,last_status,last_error,range_mode,since_date,until_date,since_time,until_time,months_ago,period,api_token,account_id,client_logo)
      VALUES ('existing','Example existing schedule','appsec','example-zone','example.com',7,-420,'weekly',1,15,2,'["example@example.com"]','Subject','Message',0,'Example customer',1,'2026-09-01','2026-09-02','2026-09-03','success',NULL,'period','2026-09-01','2026-09-02','09:30','10:45',1,'last_week','offline-token','example-account','data:image/png;base64,example');
      INSERT INTO send_history(id,schedule_id,started_at,status,recipients) VALUES ('history','existing','2026-09-01','success','[]');`);
    const before = db.prepare("SELECT * FROM schedules").all();
    const columns = (db.prepare("PRAGMA table_info(schedules)").all() as { name: string }[]).map(c => c.name).sort();
    const history = db.prepare("SELECT * FROM send_history").all();
    const others = db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE '%schedules%' ORDER BY name").all();
    db.exec(readFileSync(resolve("migrations/0014_magic_transit_report.sql"), "utf8"));
    expect(db.prepare("SELECT * FROM schedules").all()).toEqual(before);
    expect((db.prepare("PRAGMA table_info(schedules)").all() as { name: string }[]).map(c => c.name).sort()).toEqual(columns);
    expect(db.prepare("SELECT * FROM send_history").all()).toEqual(history);
    expect(db.prepare("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE '%schedules%' ORDER BY name").all()).toEqual(others);
    db.exec("UPDATE schedules SET report_type = 'magic-transit', zone_id = NULL, zone_name = NULL WHERE id = 'existing'");
    expect(() => db.exec("UPDATE schedules SET report_type = 'invalid' WHERE id = 'existing'")).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally { db.close(); }
});

test("schedule API accepts account products without zones and retains credentials on edit", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of readdirSync(resolve("migrations")).filter(n => n.endsWith(".sql")).sort()) db.exec(readFileSync(resolve("migrations", name), "utf8"));
    const env = { DB: { prepare: (sql: string) => ({ bind: (...args: (string | number | null)[]) => ({ run: async () => db.prepare(sql).run(...args), first: async () => db.prepare(sql).get(...args) }) }) } };
    const app = new Hono();
    app.post("/api/schedules", handleCreateSchedule); app.put("/api/schedules/:id", handleUpdateSchedule);
    const input = { name: "Example schedule", reportType: "magic-transit", rangeMode: "period", period: "yesterday", frequency: "daily", sendHourUtc: 2, tzOffset: -420, recipients: ["recipient@example.com"], subject: "Magic Transit {{account}}", apiToken: "offline-schedule-token", accountId: "00000000000000000000000000000000", clientName: "Example customer", clientLogo: "data:image/png;base64,example" };
    const request = (path: string, body: unknown, method = "POST") => app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
    const created = await request("/api/schedules", input);
    expect(created.status).toBe(201);
    const result = await created.json();
    expect(result.schedule.reportType).toBe("magic-transit");
    expect(result.schedule.zoneId).toBeNull();
    expect(result.schedule.apiTokenSet).toBe(true);
    expect(JSON.stringify(result)).not.toContain(input.apiToken);
    const { apiToken: _token, ...edit } = input;
    const edited = await request(`/api/schedules/${result.schedule.id}`, { ...edit, name: "Renamed" }, "PUT");
    expect(edited.status).toBe(200);
    const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(result.schedule.id)!;
    expect(row.api_token).toBe(input.apiToken);
    expect(row.account_id).toBe(input.accountId);
    expect(row.client_logo).toBe(input.clientLogo);
    expect(row.period).toBe("yesterday");
    expect((await request("/api/schedules", { ...input, reportType: "appsec" })).status).toBe(400);
    expect((await request("/api/schedules", { ...input, reportType: "zero-trust" })).status).toBe(201);
    expect((await request("/api/schedules", { ...input, reportType: "unknown" })).status).toBe(400);
  } finally { db.close(); }
});
