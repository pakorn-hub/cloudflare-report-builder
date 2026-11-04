/**
 * Cloudflare Pages Function — reverse proxy for /api/* routes.
 *
 * NOTE: this file is only needed if you deploy the frontend as a *separate*
 * Cloudflare Pages project instead of the default single-Worker topology
 * (where the Worker serves the built frontend directly via [assets] in
 * wrangler.toml — see README.md). If you're using the default topology,
 * you can ignore/delete this whole `functions/` directory.
 *
 * Handles /api/me locally by extracting the user email from the
 * Cloudflare Access JWT. Proxies everything else to the Worker at
 * API_WORKER_URL (set this as a Pages environment variable in the
 * dashboard: Settings → Environment variables).
 *
 * Access JWT sources (in priority order):
 *   1. Cf-Access-Authenticated-User-Email header  — set for identity policies
 *   2. CF_Authorization cookie                    — JWT set by Access on auth
 *   3. Cf-Access-Jwt-Assertion header             — same JWT, header form
 *
 * The JWT payload contains an "email" claim for both identity and
 * Warp/Gateway device policies (device_user_id maps to a user with email).
 * We decode the payload (middle segment of the JWT) — no signature
 * verification needed here since Cloudflare already validated it to get
 * this far past the Access policy.
 */

/**
 * Extract the email from a Cloudflare Access JWT string.
 * The JWT payload is the second dot-separated segment, base64url encoded.
 * Returns null if the token is missing or malformed.
 */
function emailFromJwt(token: string | null): string | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    // base64url → base64 → decode
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(payload);
    const claims = JSON.parse(json) as Record<string, unknown>;
    // "email" claim is present for identity-based and Warp policies
    return typeof claims["email"] === "string" ? claims["email"] : null;
  } catch {
    return null;
  }
}

/**
 * Parse the CF_Authorization cookie value from a Cookie header string.
 */
function parseCfAuthCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name.trim() === "CF_Authorization") return rest.join("=").trim();
  }
  return null;
}

interface PagesEnv {
  /** URL of the deployed Worker API, e.g. https://your-worker.your-subdomain.workers.dev
   *  Set as a Pages environment variable (dashboard → Settings → Environment variables). */
  API_WORKER_URL?: string;
}

export async function onRequest(context: {
  request: Request;
  params: { path: string[] };
  env: PagesEnv;
}): Promise<Response> {
  const { request, params, env } = context;
  const path = (params.path ?? []).join("/");

  // ── /api/me — extract email from Access JWT ───────────────────────────────
  // Handled entirely locally — never needs API_WORKER_URL — so this keeps
  // working even if the proxy below isn't configured yet.
  if (path === "me" && request.method === "GET") {
    // 1. Direct header (identity policies)
    const directEmail =
      request.headers.get("Cf-Access-Authenticated-User-Email") ??
      request.headers.get("cf-access-authenticated-user-email");

    if (directEmail) {
      return Response.json({ ok: true, email: directEmail });
    }

    // 2. Decode JWT from CF_Authorization cookie (Warp / Gateway policies)
    const cookieJwt  = parseCfAuthCookie(request.headers.get("cookie"));
    const headerJwt  = request.headers.get("Cf-Access-Jwt-Assertion");
    const email      = emailFromJwt(cookieJwt) ?? emailFromJwt(headerJwt);

    return Response.json({ ok: true, email });
  }

  // ── Proxy everything else to the Worker ───────────────────────────────────
  const workerUrl = env.API_WORKER_URL;
  if (!workerUrl) {
    return Response.json(
      { error: "API_WORKER_URL is not configured for this Pages project (Settings → Environment variables)." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const targetUrl = `${workerUrl}/api/${path}${url.search}`;

  // Forward all original headers including CF_Authorization cookie so the
  // Worker (if behind Access) accepts the request as already-authenticated.
  // Also forward Cf-Access-Jwt-Assertion as a header for service-token flows.
  const forwardHeaders = new Headers(request.headers);

  // Extract the Access JWT from the cookie and also set it as the
  // Cf-Access-Jwt-Assertion header — some Access policies check the header
  const cookieJwt = parseCfAuthCookie(request.headers.get("cookie"));
  if (cookieJwt && !forwardHeaders.has("Cf-Access-Jwt-Assertion")) {
    forwardHeaders.set("Cf-Access-Jwt-Assertion", cookieJwt);
  }

  const response = await fetch(new Request(targetUrl, {
    method:  request.method,
    headers: forwardHeaders,
    body:    request.method !== "GET" && request.method !== "HEAD"
               ? request.body
               : undefined,
    redirect: "follow",
  }));

  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers:    response.headers,
  });
}
