/**
 * Builds the scheduled email's full-report attachment: the ON-DEMAND report
 * itself, self-contained.
 *
 * The on-demand page is a React app, which the Worker cannot execute — but an
 * email attachment is opened in the recipient's browser, which can. So the
 * attachment is assembled from the pieces that already exist:
 *
 *   1. the single-chunk static build of the web app
 *      (vite.static.config.ts → dist/static-report/app.js|app.css, served by
 *      this Worker's own ASSETS binding — deterministic filenames, no hashed
 *      imports to rewrite),
 *   2. the report data + AI summary the scheduler just generated, inlined as
 *      window.__EMBEDDED_REPORT__,
 *
 * and when opened, the app boots in embedded mode and renders the exact same
 * report the on-demand page renders — same components, same recharts charts,
 * same styling — with zero network access.
 *
 * Returns null when the static bundle cannot be fetched (e.g. a Worker
 * without the web assets); callers should fall back to the server-rendered
 * full-report HTML in that case.
 */

import type { Env } from "../types";

/** Shape consumed by the web app's embedded mode (App.tsx → EmbeddedReport). */
export interface EmbeddedReportPayload {
  kind: "appsec" | "zero-trust" | "magic-transit" | "custom-dashboard";
  data: unknown;
  input: Record<string, unknown>;
  aiSummary?: string;
  generatedAt: string;
  scheduleName: string;
}

const STATIC_JS = "/static-report/app.js";
const STATIC_CSS = "/static-report/app.css";

export async function buildEmbeddedReportAttachment(
  env: Env,
  payload: EmbeddedReportPayload,
  title: string
): Promise<string | null> {
  if (!env.ASSETS) {
    console.warn("[attachment] no ASSETS binding on this Worker");
    return null;
  }
  try {
    // The URL is irrelevant to the ASSETS binding — only the path is matched.
    const [jsRes, cssRes] = await Promise.all([
      env.ASSETS.fetch(new Request(`https://assets${STATIC_JS}`)),
      env.ASSETS.fetch(new Request(`https://assets${STATIC_CSS}`)),
    ]);
    if (!jsRes.ok || !cssRes.ok) {
      console.warn(`[attachment] static bundle fetch failed: app.js=${jsRes.status}, app.css=${cssRes.status}`);
      return null;
    }
    const js = await jsRes.text();
    const css = await cssRes.text();
    if (!js.includes("root") || js.length < 10_000) {
      console.warn(`[attachment] static bundle looks wrong (${js.length} bytes)`);
      return null;
    }

    // Embedding safety: a literal "</script" inside the JSON payload or the
    // bundle would terminate the host <script> tag. Both are escaped in ways
    // that are legal in their embedded positions (JS string escape / JSON
    // unicode escape), so the file stays one valid document.
    const json = JSON.stringify(payload).replace(/</g, "\\u003c");
    const jsSafe = js.replace(/<\/script>/gi, "<\\/script>");
    const cssSafe = css.replace(/<\/style>/gi, "<\\/style>");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
${payload.kind === "custom-dashboard" ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"/>` : ""}
<title>${title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</title>
<style>${cssSafe}</style>
${payload.kind === "custom-dashboard" ? `<!-- Standalone dashboard: one page context avoids headless Chromium SVG page breaks. -->
<style>@media print { @page { size: A4; margin: 12mm; } @page :first { margin: 12mm; } .cd-page #report-content { page: auto; } }</style>` : ""}
</head>
<body>
<div id="root"></div>
<script>
window.__EMBEDDED_REPORT__ = ${json};
</script>
<script type="module">
${jsSafe}
</script>
</body>
</html>`;
  } catch (e) {
    console.warn("[attachment] embedded build failed, falling back to server renderer:", String(e));
    return null;
  }
}
