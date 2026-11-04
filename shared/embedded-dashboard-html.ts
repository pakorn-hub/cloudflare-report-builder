import type { DashboardSnapshot } from "./custom-dashboard";

/** Trusted local application bundle plus data-only snapshot; never includes credentials. */
export function embeddedDashboardHtml(data: DashboardSnapshot, js: string, css: string): string {
  const title = data.title.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]!));
  const payload = JSON.stringify({ kind: "custom-dashboard", data, input: {}, generatedAt: data.capturedAt, scheduleName: "" }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"/>
<title>${title}</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style>
<style>@media print { @page { size: A4; margin: 12mm; } @page :first { margin: 12mm; } .cd-page #report-content { page: auto; } }</style>
</head><body><div id="root"></div><script>window.__EMBEDDED_REPORT__ = ${payload};</script><script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
