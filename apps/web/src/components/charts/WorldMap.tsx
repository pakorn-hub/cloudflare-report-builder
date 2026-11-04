/**
 * WorldMap — D3-geo choropleth using Natural Earth projection.
 * Inspired by https://observablehq.com/@d3/world-choropleth/2
 *
 * Uses d3-geo for projection + path generation.
 * Uses topojson-client to extract country features.
 * Color scale: sequential Cloudflare orange (cream → tangerine).
 */
import { useMemo, useState, useRef, useEffect } from "react";
import * as d3geo from "d3-geo";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { CountryDataRow } from "../../types";
import { alpha2ToNumeric, alpha2ToName } from "../../utils/country-codes";
import { formatNumber } from "../../utils/formatters";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import geoData from "../../assets/countries-50m.json";

interface Props {
  data: CountryDataRow[];
  height?: number;
  unit?: string;
}

const COLOR_STOPS = [
  "#FEF3E2", "#FDE8C5", "#FAC97A",
  "#F6A633", "#F6821F", "#E06010", "#C04808",
];

function scaleColor(value: number, max: number): string {
  if (!value || max === 0) return COLOR_STOPS[0];
  const t = Math.log1p(value) / Math.log1p(max);
  const idx = t * (COLOR_STOPS.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, COLOR_STOPS.length - 1);
  if (lo === hi) return COLOR_STOPS[lo];
  const f = idx - lo;
  return interpolateHex(COLOR_STOPS[lo], COLOR_STOPS[hi], f);
}

function interpolateHex(a: string, b: string, t: number): string {
  const r1 = parseInt(a.slice(1, 3), 16), g1 = parseInt(a.slice(3, 5), 16), b1p = parseInt(a.slice(5, 7), 16);
  const r2 = parseInt(b.slice(1, 3), 16), g2 = parseInt(b.slice(3, 5), 16), b2p = parseInt(b.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t).toString(16).padStart(2, "0");
  const g = Math.round(g1 + (g2 - g1) * t).toString(16).padStart(2, "0");
  const bl = Math.round(b1p + (b2p - b1p) * t).toString(16).padStart(2, "0");
  return `#${r}${g}${bl}`;
}

export default function WorldMap({ data, height = 340, unit = "requests" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; name: string; code: string; requests: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() =>
      setWidth(containerRef.current?.offsetWidth ?? 700)
    );
    ro.observe(containerRef.current);
    setWidth(containerRef.current.offsetWidth ?? 700);
    return () => ro.disconnect();
  }, []);

  const requestByNumeric = useMemo(() => {
    const m = new Map<string, { requests: number; code: string }>();
    for (const row of data) {
      const num = alpha2ToNumeric(row.clientCountryName);
      if (num && num !== "000") {
        m.set(num, { requests: row.requests, code: row.clientCountryName });
      }
    }
    return m;
  }, [data]);

  const maxRequests = useMemo(
    () => Math.max(...Array.from(requestByNumeric.values()).map((v) => v.requests), 1),
    [requestByNumeric]
  );

  const projection = useMemo(
    () =>
      d3geo
        .geoNaturalEarth1()
        .scale(width / 6.3)
        .translate([width / 2, height / 2]),
    [width, height]
  );

  const pathGen = useMemo(
    () => d3geo.geoPath().projection(projection),
    [projection]
  );

  const topo = geoData as unknown as Topology;

  const countries = useMemo(() => {
    const collection = topojson.feature(
      topo,
      topo.objects.countries as GeometryCollection
    );
    return (collection as GeoJSON.FeatureCollection).features;
  }, [topo]);

  const borders = useMemo(
    () =>
      topojson.mesh(
        topo,
        topo.objects.countries as GeometryCollection,
        (a, b) => a !== b
      ) as unknown as GeoJSON.Geometry,
    [topo]
  );

  const spherePath = useMemo(
    () => pathGen({ type: "Sphere" } as unknown as GeoJSON.Geometry) ?? "",
    [pathGen]
  );

  const graticule = useMemo(() => d3geo.geoGraticule()(), []);
  const graticulePath = useMemo(
    () => pathGen(graticule) ?? "",
    [pathGen, graticule]
  );

  return (
    <div ref={containerRef} className="relative w-full" style={{ height: height + 32 }}>
      <svg
        width={width}
        height={height}
        style={{ display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Ocean */}
        <path d={spherePath} fill="#EFF6FF" />
        {/* Graticule */}
        <path d={graticulePath} fill="none" stroke="#DBEAFE" strokeWidth={0.35} />

        {/* Countries */}
        {countries.map((feature) => {
          const rawId = (feature as GeoJSON.Feature & { id?: string | number }).id;
          const numId = String(rawId ?? "").padStart(3, "0");
          const info = requestByNumeric.get(numId);
          const fill = info ? scaleColor(info.requests, maxRequests) : "#F5F5F4";
          const d = pathGen(feature);
          if (!d) return null;
          return (
            <path
              key={numId}
              d={d}
              fill={fill}
              stroke="#ffffff"
              strokeWidth={0.3}
              style={{ cursor: info ? "pointer" : "default" }}
              onMouseEnter={(e) => {
                if (info) {
                  setTooltip({
                    x: e.clientX, y: e.clientY,
                    name: alpha2ToName(info.code),
                    code: info.code,
                    requests: info.requests,
                  });
                }
              }}
              onMouseMove={(e) => {
                if (info) setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : null);
              }}
            />
          );
        })}

        {/* Country borders */}
        <path d={pathGen(borders) ?? ""} fill="none" stroke="white" strokeWidth={0.5} />
        {/* Globe border */}
        <path d={spherePath} fill="none" stroke="#93C5FD" strokeWidth={1} />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-1 px-1">
        <span className="text-[10px] text-cf-gray-400">Low</span>
        <div style={{ display: "flex", height: 10, width: 180, borderRadius: 4, overflow: "hidden" }}>
          {COLOR_STOPS.map((c, i) => (
            <div key={i} style={{ flex: 1, backgroundColor: c }} />
          ))}
        </div>
        <span className="text-[10px] text-cf-gray-400">High</span>
        <span className="text-[10px] text-cf-gray-400 ml-1">Requests (log scale)</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-cf-navy text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <p className="font-semibold">
            {tooltip.name}{" "}
            <span className="text-white/50 font-mono">({tooltip.code})</span>
          </p>
          <p className="text-cf-orange-light mt-0.5">
            {formatNumber(tooltip.requests)} {unit}
          </p>
        </div>
      )}
    </div>
  );
}
