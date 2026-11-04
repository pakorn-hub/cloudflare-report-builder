/**
 * Caller authentication for the report-builder API.
 *
 * SECURITY: previously every /api/* route was unauthenticated by design and
 * protection was delegated entirely to an unverifiable edge deployment claim.
 * This middleware enforces a real in-repo gate before any handler runs:
 *
 *   1. When CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD are configured → require a
 *      Cloudflare Access JWT (Cf-Access-Jwt-Assertion header or CF_Authorization
 *      cookie), verify the RS256 signature against the team's JWKS with WebCrypto,
 *      and bind iss (team domain) + aud (this app's AUD tag) + exp/nbf.
 *
 *   2. Otherwise, when MANAGE_SECRET is configured → require
 *      `Authorization: Bearer <secret>` with a timing-safe comparison.
 *
 *   3. Otherwise → 503 fail-closed. Anonymous access is never permitted.
 */

import type { Context, Next } from "hono";
import type { Env } from "../types";

// ─── Base64url helpers ─────────────────────────────────────────────────────────

function b64urlDecodeBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(input.length / 4) * 4,
    "=",
  );
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function b64urlDecodeJson<T>(input: string): T {
  const bytes = b64urlDecodeBytes(input);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

// ─── JWKS caching (per-isolate, 1 hour) ────────────────────────────────────────

interface AccessJwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

let jwksCache: { domain: string; keys: AccessJwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getAccessKeys(teamDomain: string): Promise<AccessJwk[]> {
  const now = Date.now();
  if (jwksCache?.domain === teamDomain && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { redirect: "manual", signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Failed to fetch Access certs (${res.status})`);
  const body = (await res.json()) as { keys?: AccessJwk[] };
  jwksCache = { domain: teamDomain, keys: body.keys ?? [], fetchedAt: now };
  return jwksCache.keys;
}

// ─── Access JWT verification (RS256 via WebCrypto) ─────────────────────────────

interface AccessJwtPayload {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
}

async function verifyAccessJwt(jwt: string, env: Env): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> {
  const parts = jwt.split(".");
  const [headB64, payloadB64, sigB64] = parts;
  if (jwt.length > 16384 || parts.length !== 3 || !headB64 || !payloadB64 || !sigB64) {
    return { ok: false, error: "malformed JWT" };
  }
  const header = b64urlDecodeJson<{ alg?: string; kid?: string }>(headB64);
  if (header.alg !== "RS256") {
    return { ok: false, error: `unsupported alg ${header.alg}` };
  }

  const payload = b64urlDecodeJson<AccessJwtPayload>(payloadB64);
  const expectedIss = `https://${env.CF_ACCESS_TEAM_DOMAIN}`;
  if (payload.iss !== expectedIss) {
    return { ok: false, error: "issuer mismatch" };
  }
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!env.CF_ACCESS_AUD || !auds.includes(env.CF_ACCESS_AUD)) {
    return { ok: false, error: "audience mismatch" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    return { ok: false, error: "token expired" };
  }
  if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > nowSec + 60)) {
    return { ok: false, error: "token not yet valid" };
  }

  let keys: AccessJwk[];
  try {
    keys = await getAccessKeys(env.CF_ACCESS_TEAM_DOMAIN as string);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "JWKS fetch failed" };
  }
  const jwk = keys.find((k) => k.kid === header.kid && k.n && k.e);
  if (!jwk || !jwk.n || !jwk.e) {
    return { ok: false, error: "no matching JWKS key" };
  }

  // importKey for RS256
  const importableJwk = {
    kty: "RSA",
    kid: jwk.kid,
    n: jwk.n,
    e: jwk.e,
    alg: "RS256",
    ext: true,
  };
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "jwk",
      importableJwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return { ok: false, error: "JWK import failed" };
  }

  const signature = b64urlDecodeBytes(sigB64);
  const signed = new TextEncoder().encode(`${headB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    signature,
    signed,
  );
  if (!valid) {
    return { ok: false, error: "invalid signature" };
  }
  return { ok: true, email: payload.email ?? null };
}

// ─── Timing-safe bearer comparison ─────────────────────────────────────────────

async function timingSafeEqualStr(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [h1, h2] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const a = new Uint8Array(h1);
  const b = new Uint8Array(h2);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ─── Middleware ────────────────────────────────────────────────────────────────

function extractAccessJwt(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = c.req.header("Cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function requireCaller(c: Context<{ Bindings: Env }>, next: Next) {
  const teamDomain = (env2(c).CF_ACCESS_TEAM_DOMAIN ?? "").trim();
  const aud = (env2(c).CF_ACCESS_AUD ?? "").trim();
  const manageSecret = (env2(c).MANAGE_SECRET ?? "").trim();

  if (teamDomain && aud) {
    let jwt: string | null;
    try { jwt = extractAccessJwt(c); }
    catch { return c.json({ error: "Unauthorized: malformed authentication cookie." }, 401); }
    if (!jwt) {
      console.warn(`[auth] rejected: no Access JWT (header=${!!c.req.header("Cf-Access-Jwt-Assertion")}, cookie=${/CF_Authorization=/.test(c.req.header("Cookie") ?? "")}) ${c.req.method} ${new URL(c.req.url).pathname}`);
      return c.json({ error: "Unauthorized: Cloudflare Access authentication required." }, 401);
    }
    let result: Awaited<ReturnType<typeof verifyAccessJwt>>;
    try { result = await verifyAccessJwt(jwt, env2(c)); }
    catch (err) {
      console.warn(`[auth] rejected: JWT verification threw (${err instanceof Error ? err.name : "unknown"}), length=${jwt.length}`);
      return c.json({ error: "Unauthorized: invalid Cloudflare Access token." }, 401);
    }
    if (!result.ok) {
      console.warn(`[auth] rejected: ${result.error}, length=${jwt.length} ${new URL(c.req.url).pathname}`);
      return c.json({ error: `Unauthorized: ${result.error}` }, 401);
    }
    return next();
  }

  if (manageSecret) {
    const provided = (c.req.header("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!provided) {
      return c.json({ error: "Unauthorized: missing Bearer token (MANAGE_SECRET)." }, 401);
    }
    if (!(await timingSafeEqualStr(provided, manageSecret))) {
      return c.json({ error: "Unauthorized: invalid token." }, 401);
    }
    return next();
  }

  // Fail closed: no gate configured — no anonymous access is ever permitted.
  return c.json(
    {
      error:
        "API locked: configure CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD (Access JWT gate) or MANAGE_SECRET (bearer gate) via wrangler secret/dashboard. All /api routes are disabled until a caller gate is configured.",
    },
    503,
  );
}

// Hono context env accessor (typed without generics gymnastics at call sites)
function env2(c: Context<{ Bindings: Env }>): Env {
  return c.env as Env;
}
