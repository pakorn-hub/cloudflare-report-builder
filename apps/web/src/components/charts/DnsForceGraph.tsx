/**
 * DnsForceGraph — DNS network graph inspired by @d3/mobile-patent-suits
 * https://observablehq.com/@d3/mobile-patent-suits
 *
 * Layout: left-to-right layered (zone → record names → IPs → providers)
 * Top 10 DNS records by query priority (A/AAAA/CNAME/MX).
 *
 * Provider detection (frontend fallback — works even if backend enrichment missing):
 *   - CNAME/MX/NS content matched against known hostname patterns
 *   - A/AAAA IPs matched against known ASN CIDR ranges for major clouds
 */
import { useEffect, useRef, useState, useCallback } from "react";
import * as d3force from "d3-force";

// ─── Client-side hostname → provider mapping (mirrors backend patterns) ────────
const HOSTNAME_PROVIDERS: Array<{
  test: (h: string) => boolean;
  name: string;
  color: string;
}> = [
  // Cloudflare
  { test: (h) => /\.(r2\.dev|pages\.dev|workers\.dev|cfargotunnel\.com|cloudflare\.net|cloudflare\.com|cf-emailsecurity\.net|trycloudflare\.com)$/.test(h), name: "Cloudflare", color: "#F6821F" },
  // AWS
  { test: (h) => /\.(amazonaws\.com|cloudfront\.net|awsglobalaccelerator\.com|elb\.amazonaws\.com|execute-api\.)/.test(h), name: "Amazon AWS", color: "#FF9900" },
  // Azure / Microsoft
  { test: (h) => /\.(windows\.net|azure\.com|azurewebsites\.net|trafficmanager\.net|azuredns\.com|blob\.core\.windows\.net|msft\.net|mail\.protection\.outlook\.com|outlook\.com|office365\.com)$/.test(h), name: "Microsoft Azure", color: "#0078D4" },
  // Google
  { test: (h) => /\.(googleapis\.com|appspot\.com|run\.app|cloudfunctions\.net|googleusercontent\.com)$/.test(h) || /aspmx\.l\.google\.com$/.test(h), name: "Google Cloud", color: "#4285F4" },
  // Fastly
  { test: (h) => /\.(fastly\.net|fastlylb\.net)$/.test(h), name: "Fastly CDN", color: "#FF282D" },
  // Akamai
  { test: (h) => /\.(akamai\.net|akamaiedge\.net|akamaihdtech\.net)$/.test(h), name: "Akamai CDN", color: "#009BDE" },
  // Vercel
  { test: (h) => /\.(vercel\.app|now\.sh)$/.test(h), name: "Vercel", color: "#000000" },
  // Netlify
  { test: (h) => /\.netlify\.app$/.test(h), name: "Netlify", color: "#00C7B7" },
  // Heroku
  { test: (h) => /\.herokuapp\.com$/.test(h), name: "Heroku", color: "#6762A6" },
  // SendGrid
  { test: (h) => /\.sendgrid\.net$/.test(h), name: "SendGrid", color: "#1A82E2" },
  // Zoho
  { test: (h) => /\.(zoho\.com|zmailcloud\.com|zmverify\.zoho\.com)$/.test(h), name: "Zoho", color: "#E42527" },
  // GitHub Pages
  { test: (h) => /\.github\.io$/.test(h), name: "GitHub Pages", color: "#24292F" },
  // Supabase
  { test: (h) => /\.supabase\.co$/.test(h), name: "Supabase", color: "#3ECF8E" },
];

// Known ASN → provider for common cloud IPs
const ASN_PROVIDERS: Record<number, { name: string; color: string }> = {
  13335: { name: "Cloudflare",       color: "#F6821F" },
  209242:{ name: "Cloudflare",       color: "#F6821F" },
  16509: { name: "Amazon AWS",       color: "#FF9900" },
  14618: { name: "Amazon AWS",       color: "#FF9900" },
  8075:  { name: "Microsoft Azure",  color: "#0078D4" },
  8069:  { name: "Microsoft Azure",  color: "#0078D4" },
  15169: { name: "Google Cloud",     color: "#4285F4" },
  396982:{ name: "Google Cloud",     color: "#4285F4" },
  20940: { name: "Akamai CDN",       color: "#009BDE" },
  54113: { name: "Fastly CDN",       color: "#FF282D" },
  14061: { name: "DigitalOcean",     color: "#0080FF" },
  24940: { name: "Hetzner",          color: "#D50C2D" },
  16276: { name: "OVH",              color: "#123F6D" },
};

function resolveHostname(hostname: string): { name: string; color: string } | null {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  for (const p of HOSTNAME_PROVIDERS) {
    if (p.test(h)) return { name: p.name, color: p.color };
  }
  return null;
}

function resolveAsn(asn?: number): { name: string; color: string } | null {
  if (!asn) return null;
  return ASN_PROVIDERS[asn] ?? null;
}

interface DnsRecord {
  id: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  asn?: number;
  asnHolder?: string;
  provider?: string;
  providerCategory?: string;
  providerColor?: string;
}

interface Props {
  records: DnsRecord[];   // already filtered to top 10
  zoneName: string;
  height?: number;
}

type NodeKind = "zone" | "record" | "ip" | "provider";

interface FNode extends d3force.SimulationNodeDatum {
  id: string;
  label: string;
  sublabel?: string;
  kind: NodeKind;
  color: string;
  r: number;
  proxied?: boolean;
}

interface FLink extends d3force.SimulationLinkDatum<FNode> {
  source: string | FNode;
  target: string | FNode;
  type: string;
  dashed: boolean;
  color: string;
}

const TYPE_COLOR: Record<string, string> = {
  A:     "#3B82F6",
  AAAA:  "#8B5CF6",
  CNAME: "#10B981",
  MX:    "#F59E0B",
  NS:    "#EC4899",
  TXT:   "#9CA3AF",
};

export default function DnsForceGraph({ records, zoneName, height = 520 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(760);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);
  const simRef = useRef<d3force.Simulation<FNode, FLink> | null>(null);

  // Measure width responsively
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      setWidth(containerRef.current?.offsetWidth ?? 760);
    });
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 760);
    return () => ro.disconnect();
  }, []);

  const showTip = useCallback((e: MouseEvent, lines: string[]) => {
    setTooltip({ x: e.clientX, y: e.clientY, lines });
  }, []);
  const hideTip = useCallback(() => setTooltip(null), []);

  useEffect(() => {
    if (!svgRef.current || !records.length || width < 100) return;

    // Tear down previous simulation
    simRef.current?.stop();
    const svg = svgRef.current;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    // ─── Build graph data ─────────────────────────────────────────────────
    const nodes: FNode[] = [];
    const links: FLink[] = [];
    const seen = new Set<string>();

    function addNode(n: FNode) {
      if (!seen.has(n.id)) { nodes.push(n); seen.add(n.id); }
    }

    // Layer 0: Zone root
    addNode({ id: "zone", label: zoneName, kind: "zone", color: "#F6821F", r: 24, fx: 60, fy: height / 2 });

    // Only show A, AAAA, CNAME, MX (skip pure TXT/NS for cleaner graph)
    const useful = records.filter((r) => ["A","AAAA","CNAME","MX"].includes(r.type));

    // Layer 1: Record hostnames — evenly spaced vertically
    const step = Math.min(44, (height - 60) / Math.max(useful.length, 1));
    const startY = height / 2 - ((useful.length - 1) * step) / 2;

    useful.forEach((rec, i) => {
      const nameId = `name:${rec.name}:${rec.type}`;
      const isApex = rec.name === zoneName || rec.name === `${zoneName}.`;
      const shortName = isApex ? "@" : rec.name.replace(new RegExp(`\\.?${zoneName}\\.?$`), "") || rec.name;
      const tc = TYPE_COLOR[rec.type] ?? "#9CA3AF";

      addNode({
        id: nameId,
        label: shortName,
        sublabel: rec.type,
        kind: "record",
        color: rec.proxied ? "#F6821F" : tc,
        r: 14,
        fx: width * 0.28,
        fy: startY + i * step,
        proxied: rec.proxied,
      });

      links.push({
        source: "zone", target: nameId,
        type: rec.type, dashed: !rec.proxied, color: tc,
      });

      // Layer 2: IPs and CNAME/MX targets
      if (rec.type === "A" || rec.type === "AAAA") {
        const ipId = `ip:${rec.content}`;
        addNode({
          id: ipId,
          label: rec.content,
          kind: "ip",
          color: rec.type === "A" ? "#60A5FA" : "#A78BFA",
          r: 10,
          fx: width * 0.54,
        });
        links.push({ source: nameId, target: ipId, type: rec.type, dashed: false, color: "#93C5FD" });

        // Layer 3: Provider — use backend data first, then client-side ASN lookup, then skip
        const backendProv = rec.provider
          ? { name: rec.provider, color: rec.providerColor ?? "#6B7280" }
          : null;
        const asnProv = backendProv ?? resolveAsn(rec.asn);
        if (asnProv) {
          const provId = `prov:${asnProv.name}`;
          addNode({
            id: provId,
            label: asnProv.name,
            sublabel: rec.asn ? `AS${rec.asn}` : undefined,
            kind: "provider",
            color: asnProv.color,
            r: 20,
            fx: width * 0.82,
          });
          links.push({ source: ipId, target: provId, type: "ASN", dashed: true, color: asnProv.color + "88" });
        }

      } else if (rec.type === "CNAME" || rec.type === "MX") {
        const content = rec.content.replace(/\.$/, "");

        // Try backend provider first, then client-side hostname resolution
        const backendProv = rec.provider
          ? { name: rec.provider, color: rec.providerColor ?? "#6B7280" }
          : null;
        const hostnameProv = backendProv ?? resolveHostname(content);

        if (hostnameProv) {
          // Known provider — show as branded provider node directly
          const provId = `prov:${hostnameProv.name}`;
          addNode({
            id: provId,
            label: hostnameProv.name,
            sublabel: rec.type === "MX" ? "Mail" : "CNAME",
            kind: "provider",
            color: hostnameProv.color,
            r: 20,
            fx: width * 0.82,
          });
          links.push({ source: nameId, target: provId, type: rec.type, dashed: true, color: hostnameProv.color + "88" });
        } else {
          // Unknown provider — show the raw hostname truncated
          const shortTarget = content.split(".").slice(-3).join(".");
          const targetId = `host:${content}`;
          addNode({
            id: targetId,
            label: shortTarget,
            sublabel: rec.type === "MX" ? "Mail" : "CNAME",
            kind: "provider",
            color: rec.type === "MX" ? "#F59E0B" : "#9CA3AF",
            r: 16,
            fx: width * 0.82,
          });
          links.push({ source: nameId, target: targetId, type: rec.type, dashed: true, color: TYPE_COLOR[rec.type] ?? "#ccc" });
        }
      }
    });

    if (nodes.length < 2) return;

    // ─── D3 force simulation ──────────────────────────────────────────────
    const sim = d3force.forceSimulation<FNode>(nodes)
      .force("link",
        d3force.forceLink<FNode, FLink>(links)
          .id((d) => d.id)
          .distance(60)
          .strength(0.5)
      )
      .force("charge", d3force.forceManyBody<FNode>().strength((d) => -d.r * 25))
      .force("collide", d3force.forceCollide<FNode>().radius((d) => d.r + 8).strength(0.8))
      .force("y", d3force.forceY<FNode>(height / 2).strength(0.01));

    simRef.current = sim;

    // ─── SVG elements ─────────────────────────────────────────────────────
    const NS = "http://www.w3.org/2000/svg";

    // Defs: arrowhead
    const defs = document.createElementNS(NS, "defs");
    // One marker per link type color
    const markerColors = [...new Set(links.map((l) => l.color))];
    markerColors.forEach((col) => {
      const mid = `arr-${col.replace("#", "")}`;
      const mk = document.createElementNS(NS, "marker");
      mk.setAttribute("id", mid);
      mk.setAttribute("viewBox", "0 -5 10 10");
      mk.setAttribute("refX", "22");
      mk.setAttribute("refY", "0");
      mk.setAttribute("markerWidth", "5");
      mk.setAttribute("markerHeight", "5");
      mk.setAttribute("orient", "auto");
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", "M0,-5L10,0L0,5");
      p.setAttribute("fill", col);
      mk.appendChild(p);
      defs.appendChild(mk);
    });
    svg.appendChild(defs);

    // Background
    const bg = document.createElementNS(NS, "rect");
    bg.setAttribute("width", String(width)); bg.setAttribute("height", String(height));
    bg.setAttribute("fill", "#FAFAF9");
    svg.appendChild(bg);

    // Layer labels
    [
      { x: 60,         label: "Zone" },
      { x: width * 0.28, label: "DNS Records" },
      { x: width * 0.54, label: "IP Addresses" },
      { x: width * 0.82, label: "Providers" },
    ].forEach(({ x, label }) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("x", String(x));
      t.setAttribute("y", "16");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "10");
      t.setAttribute("font-weight", "700");
      t.setAttribute("fill", "#A8A29E");
      t.setAttribute("font-family", "Inter, system-ui, sans-serif");
      t.setAttribute("letter-spacing", "0.04em");
      t.textContent = label.toUpperCase();
      svg.appendChild(t);
    });

    // Links
    const linkG = document.createElementNS(NS, "g");
    const linkEls = links.map((l) => {
      const line = document.createElementNS(NS, "line");
      line.setAttribute("stroke", l.color);
      line.setAttribute("stroke-width", "1.5");
      line.setAttribute("stroke-opacity", "0.65");
      if (l.dashed) line.setAttribute("stroke-dasharray", "5 3");
      line.setAttribute("marker-end", `url(#arr-${l.color.replace("#", "")})`);
      linkG.appendChild(line);
      return line;
    });
    svg.appendChild(linkG);

    // Link type labels (small, on midpoint)
    const linkLabelG = document.createElementNS(NS, "g");
    const linkLabelEls = links.map((l) => {
      const t = document.createElementNS(NS, "text");
      t.setAttribute("text-anchor", "middle");
      t.setAttribute("font-size", "8");
      t.setAttribute("fill", l.color);
      t.setAttribute("font-family", "Inter, system-ui, sans-serif");
      t.setAttribute("font-weight", "600");
      t.setAttribute("pointer-events", "none");
      t.textContent = l.type;
      linkLabelG.appendChild(t);
      return t;
    });
    svg.appendChild(linkLabelG);

    // Nodes
    const nodeG = document.createElementNS(NS, "g");
    const nodeEls = nodes.map((n) => {
      const g = document.createElementNS(NS, "g");
      g.style.cursor = "default";

      // Shadow / glow for providers and zone
      if (n.kind === "zone" || n.kind === "provider") {
        const shadow = document.createElementNS(NS, "circle");
        shadow.setAttribute("r", String(n.r + 5));
        shadow.setAttribute("fill", n.color);
        shadow.setAttribute("fill-opacity", "0.15");
        g.appendChild(shadow);
      }

      const circle = document.createElementNS(NS, "circle");
      circle.setAttribute("r", String(n.r));
      circle.setAttribute("fill", n.color);
      circle.setAttribute("fill-opacity", "0.9");
      circle.setAttribute("stroke", "white");
      circle.setAttribute("stroke-width", n.kind === "zone" ? "3" : "1.5");
      g.appendChild(circle);

      // Proxied indicator ring
      if (n.proxied) {
        const ring = document.createElementNS(NS, "circle");
        ring.setAttribute("r", String(n.r + 4));
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", "#F6821F");
        ring.setAttribute("stroke-width", "1.5");
        ring.setAttribute("stroke-dasharray", "3 2");
        g.appendChild(ring);
      }

      // Label inside circle
      const maxChars = Math.max(4, Math.floor(n.r / 3.2));
      const mainLabel = n.label.length > maxChars ? n.label.slice(0, maxChars - 1) + "…" : n.label;

      if (n.r >= 10) {
        const t = document.createElementNS(NS, "text");
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", n.sublabel ? "auto" : "middle");
        t.setAttribute("y", n.sublabel ? "-3" : "0");
        t.setAttribute("font-size", n.r >= 20 ? "10" : "9");
        t.setAttribute("font-weight", "700");
        t.setAttribute("fill", "white");
        t.setAttribute("font-family", "Inter, system-ui, sans-serif");
        t.setAttribute("pointer-events", "none");
        t.textContent = mainLabel;
        g.appendChild(t);

        if (n.sublabel) {
          const sub = document.createElementNS(NS, "text");
          sub.setAttribute("text-anchor", "middle");
          sub.setAttribute("dominant-baseline", "hanging");
          sub.setAttribute("y", "3");
          sub.setAttribute("font-size", "7");
          sub.setAttribute("fill", "rgba(255,255,255,0.7)");
          sub.setAttribute("font-family", "Inter, system-ui, sans-serif");
          sub.setAttribute("pointer-events", "none");
          sub.textContent = n.sublabel;
          g.appendChild(sub);
        }
      }

      // Hover
      g.addEventListener("mouseenter", (e) => {
        const me = e as MouseEvent;
        const lines: string[] = [n.label];
        if (n.sublabel) lines.push(n.sublabel);
        if (n.kind === "record") lines.push(n.proxied ? "Proxied through Cloudflare" : "DNS-only");
        if (n.kind === "ip") lines.push("IP Address");
        if (n.kind === "provider") lines.push("Hosting Provider");
        showTip(me, lines);
        circle.setAttribute("stroke", "#F6821F");
        circle.setAttribute("stroke-width", "3");
      });
      g.addEventListener("mouseleave", () => {
        hideTip();
        circle.setAttribute("stroke", "white");
        circle.setAttribute("stroke-width", n.kind === "zone" ? "3" : "1.5");
      });
      g.addEventListener("mousemove", (e) => {
        const me = e as MouseEvent;
        setTooltip((t) => t ? { ...t, x: me.clientX, y: me.clientY } : null);
      });

      nodeG.appendChild(g);
      return g;
    });
    svg.appendChild(nodeG);

    // Tick
    function tick() {
      links.forEach((l, i) => {
        const s = l.source as FNode;
        const t = l.target as FNode;
        const sx = s.x ?? 0, sy = s.y ?? 0, tx = t.x ?? 0, ty = t.y ?? 0;
        linkEls[i].setAttribute("x1", String(sx));
        linkEls[i].setAttribute("y1", String(sy));
        linkEls[i].setAttribute("x2", String(tx));
        linkEls[i].setAttribute("y2", String(ty));
        linkLabelEls[i].setAttribute("x", String((sx + tx) / 2));
        linkLabelEls[i].setAttribute("y", String((sy + ty) / 2 - 4));
      });
      nodes.forEach((n, i) => {
        // Clamp to bounds
        n.x = Math.max(n.r + 4, Math.min(width - n.r - 4, n.x ?? width / 2));
        n.y = Math.max(n.r + 24, Math.min(height - n.r - 8, n.y ?? height / 2));
        nodeEls[i].setAttribute("transform", `translate(${n.x},${n.y})`);
      });
    }

    sim.on("tick", tick);
    // Pre-run for static/print stability
    for (let i = 0; i < 300; i++) sim.tick();
    sim.stop();
    tick();

    return () => { sim.stop(); };
  }, [records, zoneName, width, height, showTip, hideTip]);

  const legendItems = [
    { color: "#F6821F", label: "Zone / Proxied" },
    { color: "#3B82F6", label: "A record" },
    { color: "#8B5CF6", label: "AAAA record" },
    { color: "#10B981", label: "CNAME" },
    { color: "#F59E0B", label: "MX" },
    { color: "#60A5FA", label: "IP Address" },
    { color: "#6B7280", label: "Provider / ASN" },
  ];

  return (
    <div ref={containerRef} className="relative w-full bg-white rounded-xl shadow-sm border border-cf-gray-200 overflow-hidden">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      />

      {/* Legend */}
      <div className="px-4 py-3 border-t border-cf-gray-100 flex flex-wrap gap-x-4 gap-y-1.5">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-[10px] text-cf-gray-500">{item.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-2">
          <div className="w-6 h-px border-t-2 border-dashed border-cf-gray-300" />
          <span className="text-[10px] text-cf-gray-400">Dashed = DNS-only / indirect</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-px border-t-2 border-cf-gray-500" />
          <span className="text-[10px] text-cf-gray-400">Solid = proxied / direct</span>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}
        >
          {tooltip.lines.map((line, i) => (
            <p key={i} className={i === 0 ? "font-semibold" : "text-white/70 mt-0.5"}>{line}</p>
          ))}
        </div>
      )}
    </div>
  );
}
