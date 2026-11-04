import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { geoCentroid, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";
import geography from "../../assets/countries-50m.json";
import { alpha2ToNumeric, alpha2ToName } from "../../utils/country-codes";
import type { MtRank } from "../../../../../shared/magic-transit";

const topology = geography as unknown as Topology;
const countries = feature(topology, topology.objects.countries as GeometryCollection) as FeatureCollection;
const point = (lon: number, lat: number, radius = 1): THREE.Vector3 => {
  const a = lon * Math.PI / 180, b = lat * Math.PI / 180;
  return new THREE.Vector3(Math.cos(b) * Math.sin(a) * radius, Math.sin(b) * radius, Math.cos(b) * Math.cos(a) * radius);
};

/** A locally bundled WebGL globe; its equivalent SVG is always available to export/print. */
export default function NetworkGlobe({ data }: { data: MtRank[] }) {
  const host = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(true);
  const [available, setAvailable] = useState(true);
  const [selected, setSelected] = useState("");
  const measured = useMemo(() => data.flatMap(row => {
    const id = alpha2ToNumeric(row.name);
    const f = countries.features.find(c => String(c.id).padStart(3, "0") === id);
    return f ? [{ row, centroid: geoCentroid(f), id, feature: f }] : [];
  }), [data]);
  const center = measured[0]?.centroid[0] ?? 20;
  const path = geoPath(geoOrthographic().rotate([-center, -15]).translate([220, 220]).scale(196));

  useEffect(() => {
    if (!host.current || !interactive) return;
    const container = host.current;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setAvailable(false); return; }
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.25, 3.6); camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);
    const group = new THREE.Group(); group.rotation.y = -center * Math.PI / 180; scene.add(group);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 48), new THREE.MeshPhongMaterial({ color: "#163d60", shininess: 18, transparent: true, opacity: 0.96 })); group.add(globe);
    scene.add(new THREE.AmbientLight("#baddec", 1.4));
    const light = new THREE.DirectionalLight("#d8fcff", 2); light.position.set(-2, 3, 4); scene.add(light);
    const segments: number[] = [];
    function ring(coords: number[][]) {
      for (let i = 1; i < coords.length; i++) segments.push(...point(coords[i - 1][0], coords[i - 1][1], 1.004).toArray(), ...point(coords[i][0], coords[i][1], 1.004).toArray());
    }
    function outline(g: Geometry) {
      if (g.type === "Polygon") g.coordinates.forEach(ring);
      if (g.type === "MultiPolygon") g.coordinates.forEach(p => p.forEach(ring));
    }
    countries.features.forEach(f => { if (f.geometry) outline(f.geometry); });
    const edges = new THREE.BufferGeometry(); edges.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
    group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: "#69aec5", transparent: true, opacity: 0.7 })));
    const markers: THREE.Mesh[] = [];
    const max = Math.max(1, ...measured.map(m => m.row.packets));
    measured.forEach(m => {
      const size = 0.016 + 0.035 * Math.sqrt(m.row.packets / max);
      const marker = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 12), new THREE.MeshBasicMaterial({ color: "#ff9838" }));
      marker.position.copy(point(m.centroid[0], m.centroid[1], 1.04)); marker.userData.country = m.row.name;
      group.add(marker); markers.push(marker);
    });
    const resize = () => { const width = container.clientWidth || 440, height = container.clientHeight || 420; renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(container); resize();
    let dragging = false, lastX = 0;
    const down = (e: PointerEvent) => { dragging = true; lastX = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (dragging) { group.rotation.y += (e.clientX - lastX) * 0.008; lastX = e.clientX; } };
    const up = (e: PointerEvent) => {
      dragging = false;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      // Include the opaque sphere so a back-side marker cannot be selected through it.
      const hit = ray.intersectObjects([globe, ...markers])[0];
      if (hit?.object.userData.country) setSelected(String(hit.object.userData.country));
    };
    renderer.domElement.addEventListener("pointerdown", down); renderer.domElement.addEventListener("pointermove", move); renderer.domElement.addEventListener("pointerup", up);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0; let last = performance.now();
    const animate = (now: number) => { if (!reduced && !dragging) group.rotation.y += Math.min(now - last, 50) * 0.00004; last = now; renderer.render(scene, camera); frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointermove", move); renderer.domElement.removeEventListener("pointerup", up);
      group.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()); } });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [interactive, measured, center]);

  const chosen = measured.find(m => m.row.name === selected);
  return <div className="mt-globe">
    <svg viewBox="0 0 440 440" role="img" aria-label="Source-country traffic globe; marker sizes represent packets" className="mt-globe-fallback">
      <defs><radialGradient id="mt-ocean"><stop stopColor="#214d70" /><stop offset="1" stopColor="#102b49" /></radialGradient></defs>
      <circle cx="220" cy="220" r="196" fill="url(#mt-ocean)" stroke="#4a7994" />
      <path d={path(geoGraticule10()) ?? ""} fill="none" stroke="#36617a" strokeWidth="0.5" />
      {countries.features.map((f, i) => <path key={i} d={path(f) ?? ""} fill="#1c4565" stroke="#6b97ad" strokeWidth="0.5" />)}
      {measured.map(m => <path key={m.id} d={path(m.feature) ?? ""} fill="#f6821f" fillOpacity="0.8"><title>{alpha2ToName(m.row.name)}: {m.row.packets.toLocaleString()} packets</title></path>)}
      {measured.map(m => <path key={`marker-${m.id}`} d={path.pointRadius(3 + 7 * Math.sqrt(m.row.packets / Math.max(1, ...measured.map(v => v.row.packets))))({ type: "Point", coordinates: m.centroid }) ?? ""} fill="#ffc17b" stroke="#fff0d8" strokeWidth="0.8"><title>{alpha2ToName(m.row.name)}: {m.row.packets.toLocaleString()} packets</title></path>)}
    </svg>
    {interactive && available && <div ref={host} className="mt-globe-webgl print:hidden" />}
    <div className="mt-globe-controls print:hidden">
      <button onClick={() => setInteractive(!interactive)}>{interactive && available ? "Static view" : "3D view"}</button>
      <span>{interactive && available ? "Drag to rotate · select a marker" : "Export-friendly geographic view"}</span>
    </div>
    <p className="mt-globe-caption">{chosen ? `${alpha2ToName(chosen.row.name)} · ${chosen.row.packets.toLocaleString()} packets` : measured.length ? "Measured source countries · country-level locations" : "Geographic context · source-country data unavailable"}</p>
  </div>;
}
