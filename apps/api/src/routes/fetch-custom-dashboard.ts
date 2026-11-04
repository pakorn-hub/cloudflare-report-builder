import type { Context } from "hono";
import type { Env } from "../types";
import type { ReportRangeMode } from "../types";
import type { ReportPeriod } from "../services/cf-graphql";
import { validateDashboardTemplate } from "../../../../shared/custom-dashboard-template";
import { dashboardRange, generateCustomDashboardData, type CustomDashboardInput } from "../services/cf-custom-dashboard";

export async function handleFetchCustomDashboard(c: Context<{ Bindings: Env }>) {
  let input: CustomDashboardInput;
  try {
    const b = await c.req.json<Record<string, unknown>>();
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new Error("Expected report parameters.");
    if (typeof b.token !== "string" || b.token.length < 10 || b.token.length > 500) throw new Error("An analytics API token is required.");
    if (typeof b.zoneId !== "string" || !/^[a-f\d]{32}$/i.test(b.zoneId) || typeof b.accountId !== "string" || !/^[a-f\d]{32}$/i.test(b.accountId)) throw new Error("Valid account ID and zone ID are required.");
    const text = (key: string, max: number): string | undefined => {
      const value = b[key];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${key}.`);
      return value;
    };
    const numeric = (key: string, fallback?: number): number | undefined => {
      if (b[key] === undefined || b[key] === null) return fallback;
      if (typeof b[key] !== "number" || !Number.isFinite(b[key])) throw new Error(`Invalid ${key}.`);
      return b[key];
    };
    const rangeMode = text("rangeMode", 20) ?? "rolling", period = text("period", 20);
    if (!["rolling", "period", "calendar_month", "custom"].includes(rangeMode)) throw new Error("Unsupported range mode.");
    if (period && !["yesterday", "last_week", "last_month"].includes(period)) throw new Error("Unsupported report period.");
    input = { token: b.token, accountId: b.accountId, zoneId: b.zoneId, zoneName: text("zoneName", 200),
      days: numeric("days", 1)!, tzOffset: numeric("tzOffset", 0)!, monthsAgo: numeric("monthsAgo"),
      rangeMode: rangeMode as ReportRangeMode, period: period as ReportPeriod | undefined,
      sinceDate: text("sinceDate", 10), untilDate: text("untilDate", 10), sinceTime: text("sinceTime", 5), untilTime: text("untilTime", 5),
      template: validateDashboardTemplate(b.template) };
    dashboardRange(input);
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : "Invalid report parameters." }, 400); }
  try { return c.json({ ok: true, dashboard: await generateCustomDashboardData(input) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : "Dashboard analytics unavailable." }, 502); }
}
