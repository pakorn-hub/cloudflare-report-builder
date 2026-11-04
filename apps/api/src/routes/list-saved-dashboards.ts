import type { Context } from "hono";
import type { Env } from "../types";
import { getEffectiveBackendConfig } from "../services/settings";
import { listSavedDashboards } from "../services/cf-saved-dashboards";

export async function handleListSavedDashboards(c: Context<{ Bindings: Env }>) {
  c.header("Cache-Control", "no-store");
  let b: Record<string, unknown>;
  try {
    const raw: unknown = await c.req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected dashboard listing parameters.");
    b = raw as Record<string, unknown>;
    if (b.apiToken !== undefined && b.apiToken !== null && (typeof b.apiToken !== "string" || b.apiToken.trim().length < 10 || b.apiToken.length > 500)) throw new Error("Invalid API token.");
    if (b.accountId !== undefined && (typeof b.accountId !== "string" || !/^[a-f\d]{32}$/i.test(b.accountId))) throw new Error("Account ID must be 32 hexadecimal characters.");
    if (b.scope !== "account" && b.scope !== "zone") throw new Error("Choose account or zone dashboard scope.");
    if (b.scope === "zone" && (typeof b.zoneId !== "string" || !/^[a-f\d]{32}$/i.test(b.zoneId))) throw new Error("A valid zone ID is required for zone dashboards.");
    if (b.scheduleId !== undefined && (typeof b.scheduleId !== "string" || !/^[\w-]{1,80}$/.test(b.scheduleId))) throw new Error("Invalid schedule ID.");
  } catch (e) { return c.json({ error: e instanceof Error ? e.message : "Invalid listing parameters." }, 400); }
  try {
    let stored: { api_token: string | null; account_id: string | null } | null = null;
    if (typeof b.scheduleId === "string" && b.apiToken === undefined) {
      if (!c.env.DB) return c.json({ error: "Schedule storage is not configured." }, 503);
      stored = await c.env.DB.prepare("SELECT api_token, account_id FROM schedules WHERE id = ?").bind(b.scheduleId).first();
      if (!stored) return c.json({ error: "Schedule not found." }, 404);
    }
    let token = typeof b.apiToken === "string" ? b.apiToken.trim() : stored?.api_token || "";
    let accountId = typeof b.accountId === "string" ? b.accountId : stored?.account_id || "";
    if (!token || !accountId) {
      const backend = c.env.DB ? await getEffectiveBackendConfig(c.env) : { token: c.env.CF_API_TOKEN, accountId: c.env.CF_ACCOUNT_ID };
      token ||= backend.token || ""; accountId ||= backend.accountId || "";
    }
    if (!token || !accountId) return c.json({ error: "Set an API token and account ID, or configure backend credentials, before loading saved dashboards." }, 503);
    return c.json({ ok: true, dashboards: await listSavedDashboards(token, accountId, b.scope as "account" | "zone", typeof b.zoneId === "string" ? b.zoneId : undefined) });
  } catch (e) {
    // Only the connector's controlled errors are returned; never serialize upstream bodies or credentials.
    return c.json({ error: e instanceof Error && /^(Cloudflare|Could not reach|Valid account)/.test(e.message) ? e.message : "Saved dashboards could not be loaded." }, 502);
  }
}
