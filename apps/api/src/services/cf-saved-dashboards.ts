import { savedDashboardOptions, type SavedDashboard } from "../../../../shared/saved-dashboard";
import { boundedBody } from "./cf-custom-dashboard";

/** This observed route currently fails for token callers; never fall back to a dashboard session. */
export async function listSavedDashboards(token: string, accountId: string, scope: "account" | "zone", zoneId?: string): Promise<SavedDashboard[]> {
  if (!/^[a-f\d]{32}$/i.test(accountId) || (scope === "zone" && !/^[a-f\d]{32}$/i.test(zoneId ?? ""))) throw new Error("Valid account and zone scope are required.");
  const path = `/accounts/${accountId}${scope === "zone" ? `/zones/${zoneId}` : ""}/analytics-dashboards`;
  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "manual", signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error("Could not reach Cloudflare's saved-dashboard API. No dashboards were loaded."); }
  if (!response.ok) {
    await response.body?.cancel();
    const ray = response.headers.get("cf-ray");
    const reference = ray && /^[a-z\d-]{1,80}$/i.test(ray) ? ` Reference: ${ray}.` : "";
    throw new Error(`Cloudflare saved-dashboard listing failed (HTTP ${response.status}). API-token access to saved dashboards is an upstream requirement; an active analytics token does not guarantee this access.${reference}`);
  }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(await boundedBody(response, 2 * 1024 * 1024))); }
  catch { throw new Error("Cloudflare returned an invalid or oversized saved-dashboard response. No dashboards were loaded."); }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { success?: unknown }).success !== true) throw new Error("Cloudflare did not return a successful saved-dashboard listing. No dashboards were loaded.");
  return savedDashboardOptions((body as { result?: unknown }).result, accountId, scope, zoneId);
}
