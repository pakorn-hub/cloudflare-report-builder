import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoDashboardSnapshot, type DashboardSnapshot } from "../../shared/custom-dashboard";
import { narrateDashboard } from "../../shared/report-narration";
import { buildEmbeddedReportAttachment } from "../../apps/api/src/services/attachment-builder";

const widget = (patch: Partial<DashboardSnapshot["widgets"][number]>) => ({ id: "w", title: "Widget", type: "stat" as const, rows: [], metric: "", dimension: "", unit: "", note: "", ...patch });

test("narration reads only what the report contains and never sums, invents zero or hides warnings", () => {
  const data = { ...demoDashboardSnapshot(), warnings: ["Sampled data.", "Second note"] };
  const segments = narrateDashboard(data, data.widgets);
  const text = segments.map(s => s.text).join("\n");
  expect(segments[0].text).toContain("Example traffic overview");
  expect(segments[0].text).toContain("imported point-in-time snapshot");
  expect(segments.find(s => s.id === "coverage")?.text).toContain("Sampled data.");
  expect(segments.filter(s => s.widgetId)).toHaveLength(data.widgets.length);
  expect(text).toContain("Requests is 1,200,000");
  expect(text).toContain("Cache hit ratio is 86.4 percent");
  expect(text).toContain("These are the returned rows, not a population total");
  expect(text).toContain("The highest returned value is 51,000");
  expect(segments[segments.length - 1].id).toBe("closing");

  const api = narrateDashboard({ ...data, origin: "api", warnings: [] }, []);
  expect(api[0].text).toContain("fresh API queries");
  expect(api.find(s => s.id === "coverage")).toBeUndefined();
});

test("narration says unavailable for missing data and refuses to read ambiguous widgets", () => {
  const data = demoDashboardSnapshot();
  const spokenFor = (w: ReturnType<typeof widget>) => narrateDashboard(data, [w])[1].text;
  expect(spokenFor(widget({ title: "Empty", rows: [] }))).toContain("Unavailable data is not reported as zero");
  expect(spokenFor(widget({ title: "Null", metric: "n", rows: [{ n: null }] }))).toContain("is unavailable");
  expect(spokenFor(widget({ title: "Zero", metric: "n", rows: [{ n: 0 }] }))).toContain("is 0.");
  const multi = spokenFor(widget({ title: "Many", metric: "n", rows: [{ n: 1 }, { n: 2 }] }));
  expect(multi).toContain("nothing has been summed");
  expect(multi).not.toContain("is 3");
  expect(spokenFor(widget({ title: "Neg", type: "top-n", metric: "n", dimension: "d", rows: [{ d: "a", n: -1 }, { d: "b", n: 2 }] }))).toContain("not ranked");
  expect(spokenFor(widget({ title: "One point", type: "timeseries", metric: "n", dimension: "t", rows: [{ t: "2026-09-01T00:00:00Z", n: 1 }] }))).toContain("no trend is described");
  expect(spokenFor(widget({ title: "Bad dates", type: "timeseries", metric: "n", dimension: "t", rows: [{ t: "yesterday", n: 1 }, { t: "today", n: 2 }] }))).toContain("no trend is described");
  const gaps = spokenFor(widget({ title: "Gaps", type: "timeseries", metric: "n", dimension: "t", rows: [{ t: "2026-09-01T00:00:00Z", n: 1 }, { t: "2026-09-01T01:00:00Z", n: null }, { t: "2026-09-01T02:00:00Z", n: 3 }] }));
  expect(gaps).toContain("1 observation is unavailable and not counted as zero");
  expect(spokenFor(widget({ title: "T", type: "table", rows: [{ a: 1 }] }))).toContain("See the evidence table");
  expect(spokenFor(widget({ title: "Noted", metric: "n", rows: [{ n: 5 }], note: "Sampled estimate" }))).toContain("Note: Sampled estimate.");
});

/** Headless Chrome has no voices, so replace speech with a controllable fake. */
async function fakeSpeech(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    let current: { u: SpeechSynthesisUtterance; done: () => void } | null = null, paused = false, cancels = 0;
    class Utterance { text: string; rate = 1; lang = ""; voice: unknown = null; onstart: (() => void) | null = null; onend: (() => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onboundary: (() => void) | null = null; constructor(text: string) { this.text = text; } }
    const synth = {
      getVoices: () => [{ name: "Test Voice", lang: "en-US", voiceURI: "test", default: true, localService: true }],
      addEventListener() {}, removeEventListener() {},
      speak(u: Utterance) { setTimeout(() => { if (paused) return; spoken.push(u.text); u.onstart?.(); u.onboundary?.(); current = { u: u as never, done: () => u.onend?.() }; setTimeout(() => current?.u === (u as never) && !paused && (current = null, u.onend?.()), (window as unknown as { __speechMs?: number }).__speechMs ?? 30); }, 5); },
      cancel() { cancels++; current = null; paused = false; },
      pause() { paused = true; }, resume() { paused = false; },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
    Object.defineProperty(window, "__spoken", { value: spoken });
    Object.defineProperty(window, "__cancels", { get: () => cancels });
  });
}

async function openReport(page: Page) {
  await page.route("**/api/**", route => route.fulfill({ json: { ok: true, email: null } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Custom Dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Load synthetic example" }).click();
  await page.getByRole("button", { name: /Build report/ }).click();
  await expect(page.locator(".cd-report .cd-widget").first()).toBeVisible();
}

test("droid renders a WebGL canvas, reads the report aloud, highlights widgets and can be stopped", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await fakeSpeech(page);
  await page.addInitScript(() => { (window as unknown as { __speechMs: number }).__speechMs = 400; });
  await openReport(page);
  const droid = page.getByRole("complementary", { name: "Report read-out presenter" });
  await expect(droid).toBeVisible();
  await expect(droid.locator("canvas")).toHaveCount(1);
  expect(await droid.locator("canvas").evaluate((c: HTMLCanvasElement) => c.width > 0 && c.height > 0)).toBe(true);
  await expect(page.getByTestId("droid-caption")).toContainText("Press play");
  await droid.getByRole("button", { name: "Collapse presenter" }).click();
  await expect(droid.locator("canvas")).toHaveCount(0);
  await droid.getByRole("button", { name: "Expand presenter" }).click();
  await expect(droid.locator("canvas")).toHaveCount(1);

  await droid.getByRole("button", { name: "Play read-out" }).click();
  await expect(page.getByTestId("droid-caption")).toContainText("Cloudflare custom dashboard report: Example traffic overview");
  await expect(page.locator(".cd-widget.cd-narrating")).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".cd-widget.cd-narrating h2")).toHaveText("Requests");
  await expect(page.getByTestId("droid-caption")).toContainText("Requests is 1,200,000", { timeout: 5000 });
  const said = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" "));
  expect(said).toContain("Example traffic overview");

  await droid.getByRole("button", { name: "Pause" }).click();
  await expect(droid.getByRole("button", { name: "Resume" })).toBeVisible();
  await droid.getByRole("button", { name: "Resume" }).click();
  await droid.getByRole("button", { name: "Stop read-out" }).click();
  await expect(droid.getByRole("button", { name: "Play read-out" })).toBeVisible();
  await expect(page.locator(".cd-narrating")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __cancels: number }).__cancels)).toBeGreaterThan(0);

  // Reaches the end on its own and returns to idle.
  await droid.getByRole("button", { name: "Play read-out" }).click();
  await expect(page.getByTestId("droid-caption")).toContainText("Press play", { timeout: 20000 });
  expect(errors).toEqual([]);
});

test("droid degrades honestly without speech support and is hidden for print/PDF", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true }); });
  await openReport(page);
  const droid = page.getByRole("complementary", { name: "Report read-out presenter" });
  await expect(droid).toContainText("does not support speech synthesis");
  await expect(droid.getByRole("button", { name: "Play read-out" })).toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(droid).toBeHidden();
});

test("the offline scheduled attachment carries the droid with no network and no external code", async ({ page }) => {
  const data = demoDashboardSnapshot();
  const assets = { fetch: async (request: Request) => new Response(await readFile(`apps/web/dist/static-report/${request.url.endsWith(".js") ? "app.js" : "app.css"}`, "utf8")) };
  const html = await buildEmbeddedReportAttachment({ ASSETS: assets } as never, { kind: "custom-dashboard", data, input: {}, generatedAt: "2026-09-01T00:00:00Z", scheduleName: "Synthetic" } as never, "Synthetic");
  expect(html).toBeTruthy();
  const requests: string[] = [];
  await fakeSpeech(page);
  await page.route("**/*", route => { const url = route.request().url(); if (!url.startsWith("data:") && !url.startsWith("about:")) requests.push(url); return route.abort(); });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.setContent(html!, { waitUntil: "load" });
  await expect(page.getByRole("complementary", { name: "Report read-out presenter" })).toBeVisible();
  await expect(page.locator(".cd-droid canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Play read-out" }).click();
  await expect(page.getByTestId("droid-caption")).toContainText("Example traffic overview");
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
