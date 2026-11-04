import type { Env } from "../types";
import { boundedBody } from "./cf-custom-dashboard";
import puppeteer from "@cloudflare/puppeteer";

function validatePdf(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 8 * 1024 * 1024) throw new Error("PDF exceeds the 8 MB report size limit.");
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("PDF renderer returned an invalid document.");
  return bytes;
}

/** Render self-contained HTML; never navigate to an authenticated dashboard. */
export async function renderDashboardPdf(env: Env, html: string): Promise<Uint8Array> {
  if (env.BROWSER) {
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", request => request.abort().catch(() => {}));
      await page.emulateMediaType("print");
      await page.setContent(html, { waitUntil: "load", timeout: 30000 });
      await page.waitForSelector(".cd-report .cd-widget", { timeout: 15000 });
      return validatePdf(await page.pdf({ format: "a4", printBackground: true, preferCSSPageSize: true, timeout: 30000 }));
    } finally {
      await browser.close().catch(() => console.warn("[pdf] browser session close failed"));
    }
  }
  if (!env.PDF_API_TOKEN || !/^[a-f\d]{32}$/i.test(env.PDF_ACCOUNT_ID ?? "")) {
    throw new Error("Scheduled dashboard PDFs require a BROWSER binding, or PDF_API_TOKEN (Browser Run Edit) and PDF_ACCOUNT_ID.");
  }
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.PDF_ACCOUNT_ID}/browser-run/pdf`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${env.PDF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ html, rejectRequestPattern: [".*"],
      waitForSelector: { selector: ".cd-report .cd-widget", timeout: 15000 },
      pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true } }),
  });
  if (!response.ok) throw new Error(`Dashboard PDF rendering failed (HTTP ${response.status}); check Browser Run access and quota.`);
  return validatePdf(await boundedBody(response, 8 * 1024 * 1024));
}
