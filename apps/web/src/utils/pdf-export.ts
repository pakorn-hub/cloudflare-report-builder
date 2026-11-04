/**
 * Export utilities for the POC report.
 *
 * Save to PDF  — browser native print-to-PDF (window.print()).
 *   Chrome/Edge → "Save as PDF" in print dialog.
 *   Highest fidelity, proper text, smallest file, no canvas conversion.
 *
 * Save to HTML — captures the full rendered page as a self-contained
 *   HTML file (inline styles + inlined external stylesheets + all images
 *   converted to data URIs) so it can be opened offline in any browser.
 */

// ─── Save to PDF ─────────────────────────────────────────────────────────────

export function saveToPdf(): void {
  window.print();
}

// ─── Save to HTML ─────────────────────────────────────────────────────────────

/**
 * Fetches a URL and returns its content as a base-64 data URI.
 * Used to inline external stylesheets and images into the HTML export.
 */
async function fetchAsDataUri(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // fall back to original URL if fetch fails
  }
}

/**
 * Inline all <img src="..."> elements in a cloned document node,
 * converting external URLs to data URIs so images work offline.
 */
async function inlineImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img[src]"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = (img as HTMLImageElement).src;
      if (!src || src.startsWith("data:")) return;
      const dataUri = await fetchAsDataUri(src);
      (img as HTMLImageElement).src = dataUri;
    })
  );
}

/**
 * Inline all external <link rel="stylesheet"> sheets referenced in <head>.
 * Replaces each <link> with a <style> block containing the sheet text.
 */
async function inlineStylesheets(doc: Document): Promise<void> {
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')
  );
  await Promise.all(
    links.map(async (link) => {
      try {
        const res = await fetch(link.href);
        const css = await res.text();
        const style = doc.createElement("style");
        style.textContent = css;
        link.parentNode?.replaceChild(style, link);
      } catch {
        // leave as-is if fetch fails
      }
    })
  );
}

/**
 * Serialise the current report DOM into a self-contained HTML string.
 * Used by both saveToHtml (download) and captureReportHtml (audit upload).
 */
async function serialiseReport(): Promise<string> {
  const clone = document.cloneNode(true) as Document;
  clone.querySelectorAll(".print\\:hidden").forEach((el) => el.remove());
  clone.querySelectorAll("script").forEach((el) => el.remove());
  // Custom measured charts lose ResizeObserver in a script-free snapshot.
  // Preserve their coordinate system so the SVG can scale to a smaller card.
  clone.querySelectorAll<SVGSVGElement>(".mt-report svg:not([viewBox])").forEach(svg => {
    const width = Number(svg.getAttribute("width")), height = Number(svg.getAttribute("height"));
    if (width > 0 && height > 0) svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  });
  clone.querySelectorAll('link[rel="modulepreload"], link[rel="preload"], link[rel="preconnect"], link[href*="fonts.googleapis.com"]').forEach(el => el.remove());
  await inlineStylesheets(clone);
  const extraStyle = clone.createElement("style");
  extraStyle.textContent = `
    body { background: white !important; margin: 0; }
    .print\\:hidden { display: none !important; }
    #report-content { max-width: none !important; padding: 0 !important; }
    .cover-screen-preview { border-radius: 0 !important; }
    .mt-report svg { max-width: 100%; height: auto; }
  `;
  clone.head.appendChild(extraStyle);
  await inlineImages(clone.body as HTMLElement);
  // HTML serialization preserves raw CSS text (XML serialization escapes `>`
  // in child selectors, breaking layout when the snapshot is opened as HTML).
  return "<!DOCTYPE html>\n" + clone.documentElement.outerHTML;
}

/**
 * Capture the report as a self-contained HTML string for audit storage.
 * Does NOT trigger a download — returns the HTML string directly.
 */
export async function captureReportHtml(): Promise<string> {
  return serialiseReport();
}

export async function saveToHtml(zoneName: string, dashboard?: import("../../../../shared/custom-dashboard").DashboardSnapshot): Promise<void> {
  let html: string;
  if (dashboard) {
    const [{ embeddedDashboardHtml }, js, css] = await Promise.all([
      import("../../../../shared/embedded-dashboard-html"),
      fetch("/static-report/app.js").then(r => { if (!r.ok) throw new Error("Report bundle unavailable"); return r.text(); }),
      fetch("/static-report/app.css").then(r => { if (!r.ok) throw new Error("Report stylesheet unavailable"); return r.text(); }),
    ]);
    if (!js.includes("root") || js.length < 10000) throw new Error("Report bundle unavailable; build static assets first");
    html = embeddedDashboardHtml(dashboard, js, css);
  } else html = await serialiseReport();

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `cloudflare-report-${zoneName.replace(/[^a-z0-9]/gi, "-")}-${
    new Date().toISOString().split("T")[0]
  }.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
