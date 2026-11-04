import { test, expect } from "@playwright/test";
import { Hono } from "hono";
import { requireCaller } from "../../apps/api/src/middleware/auth";

test("Access gate accepts signed application tokens and cookies, rejects forged/malformed/wrong-scope tokens", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const env = { CF_ACCESS_TEAM_DOMAIN: "synthetic-auth.cloudflareaccess.com", CF_ACCESS_AUD: "synthetic-audience" };
  const claims = { iss: `https://${env.CF_ACCESS_TEAM_DOMAIN}`, aud: [env.CF_ACCESS_AUD], exp: Math.floor(Date.now() / 1000) + 600, email: "synthetic@example.com" };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  async function sign(payload = claims) {
    const data = `${encode({ alg: "RS256", kid: "synthetic-key" })}.${encode(payload)}`;
    return `${data}.${Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(data))).toString("base64url")}`;
  }
  let handled = 0, fetches = 0;
  const app = new Hono(); app.use("/api/*", requireCaller); app.get("/api/protected", c => { handled++; return c.json({ ok: true }); });
  const request = (headers: Record<string, string>) => app.request("/api/protected", { headers }, env);
  const original = globalThis.fetch;
  globalThis.fetch = async url => { expect(url).toBe(`https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`); fetches++; return Response.json({ keys: [{ ...publicKey, kid: "synthetic-key" }] }); };
  try {
    const jwt = await sign();
    expect((await request({ "Cf-Access-Jwt-Assertion": jwt })).status).toBe(200);
    expect((await request({ Cookie: `other=value; CF_Authorization=${encodeURIComponent(jwt)}` })).status).toBe(200);
    const tampered = jwt.split("."); tampered[1] = encode({ ...claims, email: "forged@example.com" });
    for (const invalid of ["bad", "@@.@@.@@", `${jwt}.extra`, tampered.join("."), await sign({ ...claims, exp: 0 }), await sign({ ...claims, aud: ["other-audience"] }), await sign({ ...claims, iss: "https://other.cloudflareaccess.com" })]) {
      expect((await request({ "Cf-Access-Jwt-Assertion": invalid })).status).toBe(401);
    }
    expect((await request({})).status).toBe(401);
    expect((await request({ Cookie: "CF_Authorization=%invalid" })).status).toBe(401);
    expect(handled).toBe(2); expect(fetches).toBe(1);
  } finally { globalThis.fetch = original; }
});

test("API fails closed without configuration and bearer mode requires the explicit scheme", async () => {
  let handled = 0;
  const app = new Hono(); app.use("/api/*", requireCaller); app.get("/api/protected", c => { handled++; return c.json({ ok: true }); }); app.get("/health", c => c.json({ ok: true }));
  expect((await app.request("/api/protected", {}, {})).status).toBe(503);
  expect((await app.request("/health", {}, {})).status).toBe(200);
  const env = { MANAGE_SECRET: "synthetic-management-secret" };
  for (const authorization of ["", "synthetic-management-secret", "Bearer wrong-value"]) expect((await app.request("/api/protected", { headers: { authorization } }, env)).status).toBe(401);
  expect((await app.request("/api/protected", { headers: { authorization: `Bearer ${env.MANAGE_SECRET}` } }, env)).status).toBe(200);
  expect(handled).toBe(1);
});

test("no outbound request uses a redirect mode the Workers runtime rejects", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of ["apps/api/src/middleware/auth.ts", "apps/api/src/services/cf-saved-dashboards.ts", "apps/api/src/services/cf-custom-dashboard.ts", "apps/api/src/services/dashboard-pdf.ts"]) {
    expect(await readFile(file, "utf8"), file).not.toMatch(/redirect:\s*["']error["']/);
  }
});
