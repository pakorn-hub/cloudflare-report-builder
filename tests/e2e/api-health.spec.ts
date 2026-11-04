/**
 * API Health & Contract Tests
 * Tests the Worker API endpoints directly (no browser needed).
 */

import { test, expect } from "@playwright/test";

const API_BASE = process.env.API_BASE ?? "http://localhost:8787";

test.describe("API: Health & Contract", () => {
  test("GET /health returns ok", async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeDefined();
  });

  test("POST /api/appsec without body returns 400/422", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/appsec`, {
      data: {},
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test("POST /api/appsec with invalid token returns appsec object (partial data with allSettled)", async ({
    request,
  }) => {
    const res = await request.post(`${API_BASE}/api/appsec`, {
      data: {
        token: "invalid-token-xxx",
        zoneId: "00000000000000000000000000000000",
        accountId: "00000000000000000000000000000000",
      },
    });
    // Worker uses Promise.allSettled so it returns 200 with empty/partial data
    // rather than a hard 4xx. Arrays will be empty but structure is valid.
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("appsec");
    // Data arrays should be present (even if empty due to auth failure)
    expect(Array.isArray(body.appsec.certificates)).toBe(true);
  });

  test("POST /api/summary without body returns error", async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/summary`, {
      data: {},
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("Unknown route returns 404", async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/nonexistent`);
    expect(res.status()).toBe(404);
  });
});
