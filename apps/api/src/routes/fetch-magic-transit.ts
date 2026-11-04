import type { Context } from "hono";
import type { Env, ReportRangeMode } from "../types";
import { generateMagicTransitData, resolveMtRange, type MtInput } from "../services/cf-magic-transit";
export { generateMagicTransitData } from "../services/cf-magic-transit";

export async function handleFetchMagicTransit(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON body" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json({ error: "Expected report parameters" }, 400);
  const b = body as Record<string, unknown>;
  if (typeof b.token !== "string" || b.token.length < 10 || b.token.length > 500) return c.json({ error: "Missing or invalid token" }, 400);
  if (typeof b.accountId !== "string" || !/^[a-f0-9]{32}$/i.test(b.accountId)) return c.json({ error: "accountId must be 32-character hex" }, 400);
  const modes = ["rolling", "calendar_month", "custom", "period"];
  if (b.rangeMode !== undefined && !modes.includes(String(b.rangeMode))) return c.json({ error: "Invalid rangeMode" }, 400);
  if (b.tzOffset !== undefined && (typeof b.tzOffset !== "number" || !Number.isInteger(b.tzOffset) || Math.abs(b.tzOffset) > 840)) return c.json({ error: "Invalid timezone offset" }, 400);
  const rangeMode = (b.rangeMode ?? "rolling") as ReportRangeMode;
  if (rangeMode === "rolling" && b.days !== undefined && ![1, 3, 5, 7, 14, 30].includes(Number(b.days))) return c.json({ error: "Unsupported rolling period" }, 400);
  if (rangeMode === "period" && !["yesterday", "last_week", "last_month"].includes(String(b.period))) return c.json({ error: "Select yesterday, last_week or last_month" }, 400);
  if (rangeMode === "calendar_month" && (typeof b.monthsAgo !== "number" || !Number.isInteger(b.monthsAgo) || b.monthsAgo < 1 || b.monthsAgo > 12)) return c.json({ error: "monthsAgo must be 1–12" }, 400);
  const input: MtInput = {
    token: b.token, accountId: b.accountId, days: typeof b.days === "number" ? b.days : 30,
    tzOffset: typeof b.tzOffset === "number" ? b.tzOffset : 0, rangeMode,
    period: b.period as MtInput["period"], monthsAgo: b.monthsAgo as number | undefined,
    sinceDate: typeof b.sinceDate === "string" ? b.sinceDate : undefined,
    untilDate: typeof b.untilDate === "string" ? b.untilDate : undefined,
    sinceTime: typeof b.sinceTime === "string" ? b.sinceTime : undefined,
    untilTime: typeof b.untilTime === "string" ? b.untilTime : undefined,
  };
  try { resolveMtRange(input); } catch { return c.json({ error: "Invalid custom date/time range" }, 400); }
  try { return c.json({ ok: true, magicTransit: await generateMagicTransitData(input) }); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : "Magic Transit report unavailable" }, 502); }
}
