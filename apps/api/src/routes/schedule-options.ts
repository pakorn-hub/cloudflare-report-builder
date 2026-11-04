/**
 * GET /api/schedule/zones  — zone picker using the backend-bound credentials
 *                           (Settings → D1 → CF_API_TOKEN secret / CF_ACCOUNT_ID var).
 * POST /api/schedule/zones — same listing, but with credentials supplied in the
 *                           body: { apiToken?: string, accountId?: string }.
 *                           The schedule form uses this to list a CUSTOMER's
 *                           zones with their token before saving it on the
 *                           schedule (multi-customer operation). Neither the
 *                           token nor the zone list is persisted here.
 *
 * The account.id query filter is only applied when an account ID is known —
 * customer-scoped tokens can list zones without any account access.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types";
import { cfGet } from "../services/cf-rest";
import { getEffectiveBackendConfig } from "../services/settings";

interface CfZone {
  id: string;
  name: string;
  status: string;
  plan: { name: string };
}

export async function handleScheduleZones(c: Context<{ Bindings: Env }>) {
  // POST: optionally override with body-supplied (customer) credentials.
  let bodyToken: string | undefined;
  let bodyAccountId: string | undefined;
  if (c.req.method === "POST") {
    try {
      const body = (await c.req.json()) as { apiToken?: unknown; accountId?: unknown };
      if (typeof body.apiToken === "string" && body.apiToken.trim()) bodyToken = body.apiToken.trim();
      if (typeof body.accountId === "string" && body.accountId.trim()) bodyAccountId = body.accountId.trim();
    } catch { /* empty body — fall through to backend credentials */ }
    if (bodyToken !== undefined && bodyToken.length < 10) {
      return c.json({ error: "apiToken looks too short to be valid (min 10 chars)" }, 400);
    }
  }

  const backend = await getEffectiveBackendConfig(c.env);
  const token = bodyToken ?? backend.token;
  const accountId = bodyAccountId ?? backend.accountId;

  if (!token) {
    return c.json(
      {
        error: bodyToken === undefined && !backend.token
          ? "Credentials not configured. Set the backend token in Scheduled Reports → Settings, or pass a customer apiToken in the body."
          : "An API token is required to list zones.",
      },
      503
    );
  }

  const path = accountId
    ? `/zones?account.id=${accountId}&per_page=200&page=1&status=active`
    : `/zones?per_page=200&page=1&status=active`;

  const res = await cfGet<CfZone[]>(token, path);
  if (!res.ok) {
    const status = (res.status || 502) as ContentfulStatusCode;
    return c.json({ error: res.error ?? "Failed to list zones" }, status);
  }

  const zones = (res.data ?? []).map((z) => ({
    id: z.id,
    name: z.name,
    status: z.status,
    plan: z.plan?.name ?? "Unknown",
  }));

  return c.json({ ok: true, zones, accountId: accountId || null, usedBodyCredentials: bodyToken !== undefined });
}
