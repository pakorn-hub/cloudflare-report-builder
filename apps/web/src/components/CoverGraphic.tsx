/**
 * CoverGraphic — clean geometric decoration for the cover page.
 *
 * Design: abstract network / data-flow pattern.
 *   - Large diagonal grid of hexagonal nodes
 *   - Connection lines between nodes
 *   - Subtle concentric rings
 *   - Orange accent dots at key nodes
 *
 * No cloud silhouette — clean, professional, security-report aesthetic.
 */

interface Props {
  width?: number;
  height?: number;
  color?: string;
}

export default function CoverGraphic({ width = 560, height = 520, color = "#F6821F" }: Props) {
  // Build a hex-grid of nodes
  const HEX_X = 60;
  const HEX_Y = 52;
  const COLS  = Math.ceil(width  / HEX_X) + 1;
  const ROWS  = Math.ceil(height / HEX_Y) + 1;

  const nodes: { x: number; y: number; accent: boolean }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * HEX_X + (row % 2 === 0 ? 0 : HEX_X / 2);
      const y = row * HEX_Y;
      // Mark a handful of nodes as orange accents
      const accent = (row * COLS + col) % 17 === 0 || (row * COLS + col) % 23 === 0;
      nodes.push({ x, y, accent });
    }
  }

  // Edges: connect each node to right neighbour and bottom-right neighbour
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS - 1; col++) {
      const x1 = col  * HEX_X + (row % 2 === 0 ? 0 : HEX_X / 2);
      const y1 = row  * HEX_Y;
      const x2 = (col + 1) * HEX_X + (row % 2 === 0 ? 0 : HEX_X / 2);
      const y2 = y1;
      edges.push({ x1, y1, x2, y2 });
    }
    if (row < ROWS - 1) {
      for (let col = 0; col < COLS; col++) {
        const x1 = col * HEX_X + (row % 2 === 0 ? 0 : HEX_X / 2);
        const y1 = row * HEX_Y;
        // Diagonal down-right
        const x2 = x1 + HEX_X / 2;
        const y2 = y1 + HEX_Y;
        if (x2 <= width + HEX_X) edges.push({ x1, y1, x2, y2 });
        // Diagonal down-left
        const x3 = x1 - HEX_X / 2;
        if (x3 >= -HEX_X) edges.push({ x1, y1, x2: x3, y2 });
      }
    }
  }

  // Concentric rings centered top-right (decorative)
  const ringCx = width * 0.72;
  const ringCy = height * 0.28;
  const rings = [60, 110, 165, 225, 290, 360];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        {/* Fade mask — elements fade toward left edge (where text content is) */}
        <linearGradient id="cg-fade" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="white" stopOpacity="1" />
          <stop offset="30%"  stopColor="white" stopOpacity="0.6" />
          <stop offset="60%"  stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id="cg-mask">
          <rect x="0" y="0" width={width} height={height} fill="url(#cg-fade)" />
        </mask>

        {/* Clip to SVG */}
        <clipPath id="cg-clip">
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>

        {/* Radial glow for the ring area */}
        <radialGradient id="cg-glow" cx="72%" cy="28%" r="55%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ── Background glow ─────────────────────────────────────────── */}
      <rect x="0" y="0" width={width} height={height} fill="url(#cg-glow)" />

      {/* ── Network grid (masked to fade left) ──────────────────────── */}
      <g mask="url(#cg-mask)" clipPath="url(#cg-clip)">
        {/* Grid edges */}
        <g stroke={color} strokeOpacity={0.10} strokeWidth={0.8} fill="none">
          {edges.map((e, i) => (
            <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}
        </g>

        {/* Regular nodes */}
        <g fill={color} fillOpacity={0.13}>
          {nodes.filter(n => !n.accent).map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={2.2} />
          ))}
        </g>

        {/* Accent nodes — orange, slightly larger */}
        <g fill={color} fillOpacity={0.55}>
          {nodes.filter(n => n.accent).map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={3.8} />
          ))}
        </g>

        {/* Accent node outer ring */}
        <g fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={1}>
          {nodes.filter(n => n.accent).map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={7} />
          ))}
        </g>
      </g>

      {/* ── Concentric rings (top-right focal point) ────────────────── */}
      <g
        fill="none"
        stroke={color}
        clipPath="url(#cg-clip)"
      >
        {rings.map((r, i) => (
          <circle
            key={i}
            cx={ringCx}
            cy={ringCy}
            r={r}
            strokeOpacity={0.10 - i * 0.012}
            strokeWidth={1.5}
            strokeDasharray={`${r * 0.35} ${r * 0.12}`}
          />
        ))}
      </g>

      {/* ── Center focal dot at ring origin ─────────────────────────── */}
      <circle cx={ringCx} cy={ringCy} r={5}  fill={color} fillOpacity={0.35} />
      <circle cx={ringCx} cy={ringCy} r={12} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={1.5} />
      <circle cx={ringCx} cy={ringCy} r={22} fill="none" stroke={color} strokeOpacity={0.12} strokeWidth={1} />

      {/* ── Corner accent bar — top-right ───────────────────────────── */}
      <rect
        x={width - 6} y={0}
        width={6} height={height * 0.42}
        fill={color} fillOpacity={0.20}
        rx={3}
      />

      {/* ── Floating data-point clusters ────────────────────────────── */}
      {[
        { cx: width * 0.88, cy: height * 0.72, r1: 4,  r2: 14, r3: 28 },
        { cx: width * 0.55, cy: height * 0.15, r1: 3,  r2: 10, r3: 20 },
        { cx: width * 0.96, cy: height * 0.52, r1: 2.5,r2: 8,  r3: 16 },
      ].map((c, i) => (
        <g key={i} clipPath="url(#cg-clip)">
          <circle cx={c.cx} cy={c.cy} r={c.r3} fill="none" stroke={color} strokeOpacity={0.07} strokeWidth={1} />
          <circle cx={c.cx} cy={c.cy} r={c.r2} fill="none" stroke={color} strokeOpacity={0.13} strokeWidth={1} />
          <circle cx={c.cx} cy={c.cy} r={c.r1} fill={color} fillOpacity={0.40} />
        </g>
      ))}

      {/* ── Diagonal speed lines — subtle motion feel ───────────────── */}
      <g stroke={color} strokeOpacity={0.06} strokeWidth={1} clipPath="url(#cg-clip)">
        {[0.55, 0.62, 0.70, 0.78, 0.86].map((t, i) => (
          <line
            key={i}
            x1={width * t}       y1={0}
            x2={width * (t + 0.18)} y2={height}
          />
        ))}
      </g>
    </svg>
  );
}
