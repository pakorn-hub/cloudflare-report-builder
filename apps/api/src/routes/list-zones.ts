/**
 * POST /api/zones
 * Given { token, accountId }, returns the list of zones in that account.
 * Used by the frontend zone-picker dropdown so users only need token + account ID.
 */

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../types";
import { cfGet } from "../services/cf-rest";

interface CfZone {
  id: string;
  name: string;
  status: string;
  plan: { name: string };
}

interface CfZonesResponse {
  result: CfZone[];
  result_info: { count: number; total_count: number };
}

export async function handleListZones(c: Context<{ Bindings: Env }>) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Missing request body" }, 400);
  }

  const { token, accountId } = body as Record<string, unknown>;

  if (typeof token !== "string" || !token.trim()) {
    return c.json({ error: "token is required" }, 400);
  }
  if (typeof accountId !== "string" || !/^[a-f0-9]{32}$/.test(accountId)) {
    return c.json({ error: "accountId must be a 32-character hex string" }, 400);
  }

  // Fetch up to 200 zones for the account (page=1, per_page=200)
  const res = await cfGet<CfZonesResponse["result"]>(
    token.trim(),
    `/zones?account.id=${accountId}&per_page=200&page=1&status=active`
  );

  if (!res.ok) {
    const status = (res.status || 502) as ContentfulStatusCode;
    return c.json({ error: res.error ?? "Failed to list zones" }, status);
  }

  const zones = (res.data ?? []).map((z: CfZone) => ({
    id: z.id,
    name: z.name,
    status: z.status,
    plan: z.plan?.name ?? "Unknown",
  }));

  return c.json({ ok: true, zones });
}
