/**
 * VoronoiStippling — animated Voronoi stipple pattern shaped like the
 * Cloudflare logo, rendered as semi-transparent SVG dots.
 *
 * Technique (from @mbostock/voronoi-stippling):
 *   1. Sample N random points across the canvas
 *   2. Run Lloyd's algorithm: repeatedly compute Voronoi cells and move
 *      each point to its cell's centroid — points "relax" into even spacing
 *   3. Weight the dot density by a mask (Cloudflare logo shape)
 *      — more dots inside the logo, fewer outside
 *   4. Render dots as small circles; opacity controlled by the mask weight
 *
 * We approximate the Cloudflare logo using an SVG path rendered to a
 * hidden canvas for pixel-level sampling.
 */
import { useEffect, useRef, useState } from "react";
import { Delaunay } from "d3-delaunay";

interface Props {
  width: number;
  height: number;
  /** Number of stipple points (200-1000 recommended) */
  n?: number;
  /** Dot color */
  color?: string;
  /** Dot opacity 0-1 */
  opacity?: number;
  /** Lloyd relaxation iterations */
  iterations?: number;
}

// Cloudflare logo SVG path data (simplified cloud + rays silhouette)
// Normalized to fit in a 100×70 viewBox
const CF_LOGO_PATH = `
  M 50 5
  C 38 5 28 12 23 22
  C 20 20 16 19 12 20
  C 5 21 0 27 0 35
  C 0 43 6 49 14 49
  L 86 49
  C 93 49 99 43 99 36
  C 99 29 94 23 87 22
  C 87 22 87 22 87 22
  C 85 12 75 5 63 5
  C 59 5 55 6 52 8
  C 51 7 50 5 50 5 Z
`;

function sampleInLogo(
  canvasW: number, canvasH: number,
  logoW: number, logoH: number,
  logoX: number, logoY: number
): (x: number, y: number) => number {
  // Create offscreen canvas and draw the logo path
  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  // Scale logo path to fit the canvas region
  const scaleX = logoW / 100;
  const scaleY = logoH / 70;
  ctx.save();
  ctx.translate(logoX, logoY);
  ctx.scale(scaleX, scaleY);

  const path = new Path2D(CF_LOGO_PATH);
  ctx.fillStyle = "white";
  ctx.fill(path);
  ctx.restore();

  // Draw rays (diagonal lines emanating from bottom-right of cloud)
  ctx.save();
  ctx.strokeStyle = "white";
  ctx.lineWidth = logoW * 0.07;
  ctx.lineCap = "round";
  const rays = [
    [logoX + logoW * 0.28, logoY + logoH * 0.72, logoX + logoW * 0.08, logoY + logoH * 1.05],
    [logoX + logoW * 0.50, logoY + logoH * 0.72, logoX + logoW * 0.38, logoY + logoH * 1.05],
    [logoX + logoW * 0.72, logoY + logoH * 0.72, logoX + logoW * 0.68, logoY + logoH * 1.05],
  ];
  for (const [x1, y1, x2, y2] of rays) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  const imageData = ctx.getImageData(0, 0, canvasW, canvasH);
  const pixels = imageData.data;

  return function weight(x: number, y: number): number {
    const px = Math.round(Math.min(Math.max(x, 0), canvasW - 1));
    const py = Math.round(Math.min(Math.max(y, 0), canvasH - 1));
    const idx = (py * canvasW + px) * 4;
    // Alpha of the white fill = logo mask
    return pixels[idx + 3] > 0 ? 1.0 : 0.08;
  };
}

function lloydRelaxation(
  points: Float64Array,
  n: number,
  w: number, h: number,
  weight: (x: number, y: number) => number,
  iters: number
): Float64Array {
  let pts = new Float64Array(points);

  for (let iter = 0; iter < iters; iter++) {
    const delaunay = Delaunay.from({ length: n } as unknown as ArrayLike<never>, (_, i) => pts[i * 2], (_, i) => pts[i * 2 + 1]);
    const voronoi = delaunay.voronoi([0, 0, w, h]);

    // For each cell, compute weighted centroid
    const cx = new Float64Array(n);
    const cy = new Float64Array(n);
    const cw = new Float64Array(n);

    // Sample the voronoi cells on a grid
    const gridStep = 4;
    for (let y = 0; y < h; y += gridStep) {
      for (let x = 0; x < w; x += gridStep) {
        const idx = delaunay.find(x, y);
        const wt = weight(x, y);
        cx[idx] += x * wt;
        cy[idx] += y * wt;
        cw[idx] += wt;
      }
    }

    // Move points to centroids
    for (let i = 0; i < n; i++) {
      if (cw[i] > 0) {
        pts[i * 2]     = cx[i] / cw[i];
        pts[i * 2 + 1] = cy[i] / cw[i];
      }
    }

    void voronoi; // voronoi computed for centroid finding via find()
  }

  return pts;
}

export default function VoronoiStippling({
  width, height,
  n = 600,
  color = "#F6821F",
  opacity = 0.38,
  iterations = 8,
}: Props) {
  const [dots, setDots] = useState<{ x: number; y: number; r: number; o: number }[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current || width < 100) return;
    mounted.current = true;

    // Logo occupies the right ~55% of the cover, centered vertically
    const logoW = width * 0.52;
    const logoH = logoW * 0.9; // cloud aspect ratio
    const logoX = width * 0.28;
    const logoY = height * 0.5 - logoH * 0.5;

    // Get pixel weight function
    const weight = sampleInLogo(width, height, logoW, logoH * 0.65, logoX, logoY);

    // Initial random points (weighted sampling — more inside logo)
    const pts = new Float64Array(n * 2);
    let placed = 0;
    let attempts = 0;
    const rng = () => Math.random();

    while (placed < n && attempts < n * 20) {
      const x = rng() * width;
      const y = rng() * height;
      const w = weight(x, y);
      if (rng() < w + 0.05) {
        pts[placed * 2]     = x;
        pts[placed * 2 + 1] = y;
        placed++;
      }
      attempts++;
    }
    // Fill remaining with random
    while (placed < n) {
      pts[placed * 2]     = rng() * width;
      pts[placed * 2 + 1] = rng() * height;
      placed++;
    }

    // Run Lloyd's relaxation in a setTimeout to not block render
    setTimeout(() => {
      const relaxed = lloydRelaxation(pts, n, width, height, weight, iterations);

      // Build dot data
      const dotData: typeof dots = [];
      for (let i = 0; i < n; i++) {
        const x = relaxed[i * 2];
        const y = relaxed[i * 2 + 1];
        const wt = weight(x, y);
        // Dots inside logo are larger and more opaque
        const r = wt > 0.5 ? 1.8 + Math.random() * 1.4 : 0.8 + Math.random() * 0.8;
        const o = wt > 0.5 ? opacity * (0.7 + Math.random() * 0.3) : opacity * 0.15 * Math.random();
        dotData.push({ x, y, r, o });
      }

      setDots(dotData);
    }, 0);
  }, [width, height, n, opacity, iterations]);

  if (!dots.length) return null;

  return (
    <svg
      width={width}
      height={height}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        mixBlendMode: "screen",
      }}
    >
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={color}
          fillOpacity={d.o}
        />
      ))}
    </svg>
  );
}
