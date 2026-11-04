import type { DashboardSnapshot } from "../../../../shared/custom-dashboard";
import type { RenderedEmail } from "./email-template";

const escape = (value: unknown) => String(value ?? "Unavailable").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function renderCustomDashboardEmail(data: DashboardSnapshot, message: string): RenderedEmail {
  const stats = data.widgets.filter(w => w.type === "stat").map(w => `${w.title}: ${w.rows.length === 1 ? w.rows[0][w.metric] ?? "Unavailable" : "Unavailable"} ${w.unit}`);
  const text = [data.title, data.zoneName, data.period, message, ...stats, ...data.warnings,
    "Fresh API analytics. The PDF and self-contained HTML contain the complete selected report. Sampling and dataset limits apply."].filter(Boolean).join("\n\n");
  return { text, html: `<html><body style="font:14px Arial,sans-serif;color:#222"><h1>${escape(data.title)}</h1><p>${escape(data.zoneName)}</p><p>${escape(data.period)}</p><p style="white-space:pre-wrap">${escape(message)}</p><ul>${stats.map(s => `<li>${escape(s)}</li>`).join("")}</ul>${data.warnings.length ? `<h2>Data coverage</h2><ul>${data.warnings.map(s => `<li>${escape(s)}</li>`).join("")}</ul>` : ""}<p>Fresh API analytics. See the attached PDF and HTML for all selected widgets and returned evidence. Sampling and dataset limits apply.</p></body></html>` };
}
