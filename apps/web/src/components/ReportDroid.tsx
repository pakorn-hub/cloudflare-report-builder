import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Bot, ChevronDown, Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import type { NarrationSegment } from "../../../../shared/report-narration";

/**
 * A procedural humanoid droid that reads the report aloud.
 *
 * - Geometry is built from Three.js primitives: no model files, no network, so it works
 *   inside the offline HTML attachment (which has a strict no-network CSP).
 * - Voice is the browser's built-in speech synthesis. Nothing is sent anywhere.
 * - The mouth follows speech boundary events, with a steady talking motion for voices that
 *   do not emit them. Gestures change per segment; the matching widget is highlighted.
 * - If WebGL or speech is unavailable, the transcript caption and controls still work.
 */

interface Pose { rsx: number; rsz: number; rex: number; lsx: number; lsz: number; lex: number; yaw: number }
const IDLE: Pose = { rsx: 0, rsz: 0.1, rex: -0.12, lsx: 0, lsz: 0.1, lex: -0.12, yaw: 0 };
const GESTURES: Pose[] = [
  { rsx: -0.95, rsz: 0.35, rex: -0.85, lsx: 0, lsz: 0.1, lex: -0.15, yaw: -0.12 },
  { rsx: -0.55, rsz: 0.25, rex: -0.9, lsx: -0.55, lsz: 0.25, lex: -0.9, yaw: 0 },
  { rsx: 0, rsz: 1.25, rex: -0.1, lsx: 0, lsz: 0.1, lex: -0.15, yaw: -0.3 },
  { rsx: 0, rsz: 0.1, rex: -0.15, lsx: -0.95, lsz: 0.35, lex: -0.85, yaw: 0.12 },
];

const mat = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.45, ...extra });

function buildDroid() {
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(item: T): T => { disposables.push(item); return item; };
  const shell = track(mat("#e8ecf2")), dark = track(mat("#1c1f2a", { metalness: 0.5, roughness: 0.35 }));
  const red = track(mat("#ba0816", { emissive: "#6b0510", emissiveIntensity: 0.6 }));
  const glow = track(new THREE.MeshBasicMaterial({ color: "#f6821f" }));
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => new THREE.Mesh(track(geometry), material);
  const root = new THREE.Group();

  const capsule = (radius: number, length: number, material: THREE.Material, y: number) => {
    const m = mesh(new THREE.CapsuleGeometry(radius, length, 6, 14), material); m.position.y = y; return m;
  };

  const torso = new THREE.Group(); torso.position.y = 1.25; root.add(torso);
  const body = capsule(0.26, 0.4, shell, 0); body.scale.set(1.15, 1, 0.8); torso.add(body);
  const chest = mesh(new THREE.BoxGeometry(0.2, 0.14, 0.04), red); chest.position.set(0, 0.08, 0.22); torso.add(chest);
  const belt = mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 20), dark); belt.position.y = -0.3; belt.scale.set(1.15, 1, 0.8); torso.add(belt);

  const neck = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 12), dark); neck.position.y = 1.65; root.add(neck);
  const head = new THREE.Group(); head.position.y = 1.9; root.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.3, 28, 22), shell); skull.scale.set(1, 0.92, 0.95); head.add(skull);
  const visor = mesh(new THREE.BoxGeometry(0.5, 0.21, 0.1), dark); visor.position.set(0, 0.03, 0.22); head.add(visor);
  const eyeGeometry = track(new THREE.SphereGeometry(0.045, 14, 12));
  const eyes = [-1, 1].map(s => { const e = new THREE.Mesh(eyeGeometry, glow); e.position.set(s * 0.1, 0.07, 0.275); head.add(e); return e; });
  const mouth = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), glow); mouth.position.set(0, -0.03, 0.275); head.add(mouth);
  for (const s of [-1, 1]) { const ear = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 14), red); ear.rotation.z = Math.PI / 2; ear.position.set(s * 0.3, 0, 0); head.add(ear); }
  const stalk = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), dark); stalk.position.y = 0.36; head.add(stalk);
  const bulb = mesh(new THREE.SphereGeometry(0.035, 12, 10), glow); bulb.position.y = 0.46; head.add(bulb);

  const arm = (s: number) => {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.4, 1.45, 0); root.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(0.1, 16, 12), dark));
    shoulder.add(capsule(0.058, 0.26, shell, -0.2));
    const elbow = new THREE.Group(); elbow.position.y = -0.4; shoulder.add(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.07, 14, 10), dark));
    elbow.add(capsule(0.05, 0.24, shell, -0.18));
    const hand = mesh(new THREE.SphereGeometry(0.075, 14, 12), red); hand.position.y = -0.4; elbow.add(hand);
    return { shoulder, elbow };
  };
  const right = arm(1), left = arm(-1);

  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.14, 0.92, 0); root.add(hip);
    hip.add(capsule(0.085, 0.28, shell, -0.22));
    const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
    knee.add(mesh(new THREE.SphereGeometry(0.075, 12, 10), dark));
    knee.add(capsule(0.07, 0.28, shell, -0.22));
    const foot = mesh(new THREE.BoxGeometry(0.17, 0.09, 0.3), dark); foot.position.set(0, -0.46, 0.05); knee.add(foot);
  }

  const platform = mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.05, 40), dark); platform.position.y = -0.1; root.add(platform);
  const ring = mesh(new THREE.TorusGeometry(0.76, 0.012, 8, 56), glow); ring.rotation.x = Math.PI / 2; ring.position.y = -0.07; root.add(ring);

  return {
    root, torso, head, eyes, mouth, right, left,
    dispose() { disposables.forEach(item => item.dispose()); },
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
// Split only after sentence punctuation followed by whitespace; keep decimals intact.
const chunks = (text: string): string[] => text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);

export default function ReportDroid({ segments }: { segments: NarrationSegment[] }) {
  // Browser print-to-PDF renders emulate print media; skip WebGL and speech there entirely.
  const [skip] = useState(() => typeof window === "undefined" || window.matchMedia?.("print").matches);
  const speechSupported = typeof window !== "undefined" && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
  const host = useRef<HTMLDivElement>(null);
  const [webgl, setWebgl] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<"idle" | "speaking" | "paused">("idle");
  const [index, setIndex] = useState(-1);
  const [notice, setNotice] = useState("");
  const [rate, setRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState("");

  const session = useRef(0), rateRef = useRef(1), voiceRef = useRef(""), voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const live = useRef({ speaking: false, paused: false, pulse: 0, gesture: -1 });
  rateRef.current = rate; voiceRef.current = voiceUri; voicesRef.current = voices;

  useEffect(() => {
    if (skip || !speechSupported) return;
    const load = () => {
      // Only device-local voices: remote voices can transmit report text and need a network.
      const list = window.speechSynthesis.getVoices().filter(v => v.localService);
      setVoices(list);
      setVoiceUri(current => current || (list.find(v => v.default && /^en/i.test(v.lang)) ?? list.find(v => /^en/i.test(v.lang)) ?? list[0])?.voiceURI || "");
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, [skip, speechSupported]);

  const stop = useCallback((resetIndex = true) => {
    session.current++;
    if (speechSupported) window.speechSynthesis.cancel();
    live.current.speaking = false; live.current.paused = false;
    setStatus("idle"); if (resetIndex) setIndex(-1);
  }, [speechSupported]);

  const speakFrom = useCallback((start: number) => {
    if (!speechSupported || !segments.length || !voicesRef.current.length) return;
    const synth = window.speechSynthesis, sid = ++session.current;
    synth.cancel(); setNotice("");
    const finish = () => { if (sid !== session.current) return; live.current.speaking = false; setStatus("idle"); setIndex(-1); };
    const speakChunk = (k: number, parts: string[], p: number) => {
      if (sid !== session.current) return;
      if (p >= parts.length) return next(k + 1);
      const utterance = new SpeechSynthesisUtterance(parts[p]);
      utterance.rate = rateRef.current;
      const voice = voicesRef.current.find(v => v.voiceURI === voiceRef.current);
      if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
      utterance.onstart = () => { if (sid === session.current) { live.current.speaking = true; live.current.paused = false; setStatus("speaking"); } };
      utterance.onboundary = () => { live.current.pulse = 1; };
      utterance.onend = () => speakChunk(k, parts, p + 1);
      utterance.onerror = event => {
        if (sid !== session.current || event.error === "canceled" || event.error === "interrupted") return;
        live.current.speaking = false; setStatus("idle");
        setNotice("The browser could not speak this text. Read the caption below instead.");
      };
      synth.speak(utterance);
    };
    const next = (k: number) => {
      if (sid !== session.current) return;
      if (k >= segments.length) return finish();
      setIndex(k); live.current.gesture = k;
      speakChunk(k, chunks(segments[k].text), 0);
    };
    // Chrome can drop a speak() issued in the same tick as cancel().
    window.setTimeout(() => next(Math.max(0, Math.min(start, segments.length - 1))), 60);
  }, [segments, speechSupported]);

  function toggle() {
    if (status === "idle") return speakFrom(Math.max(0, index));
    const synth = window.speechSynthesis;
    if (status === "speaking") { synth.pause(); live.current.paused = true; setStatus("paused"); }
    else { synth.resume(); live.current.paused = false; setStatus("speaking"); }
  }
  const skipBy = (delta: number) => speakFrom(Math.max(0, Math.min(segments.length - 1, (index < 0 ? 0 : index) + delta)));

  // Highlight and scroll to the widget being described.
  useEffect(() => {
    const widgetId = index >= 0 ? segments[index]?.widgetId : undefined;
    if (!widgetId) return;
    const target = Array.from(document.querySelectorAll<HTMLElement>("[data-widget-id]")).find(el => el.dataset.widgetId === widgetId);
    if (!target) return;
    target.classList.add("cd-narrating");
    target.scrollIntoView({ block: "center", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return () => target.classList.remove("cd-narrating");
  }, [index, segments]);

  // Never keep talking after the page or component goes away.
  useEffect(() => () => { session.current++; if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  // Three.js scene.
  useEffect(() => {
    const container = host.current;
    if (skip || !container) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { setWebgl(false); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    camera.position.set(0, 1.35, 5.4); camera.lookAt(0, 1.2, 0);
    scene.add(new THREE.HemisphereLight("#dbe8ff", "#1c1f2a", 1.5));
    const key = new THREE.DirectionalLight("#ffffff", 2.2); key.position.set(2, 4, 4); scene.add(key);
    const rim = new THREE.DirectionalLight("#f6821f", 1.4); rim.position.set(-3, 2, -2); scene.add(rim);
    const droid = buildDroid(); scene.add(droid.root);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const pose: Pose = { ...IDLE };
    let mouth = 0, blink = 0, nextBlink = 2, raf = 0, last = performance.now(), t = 0;

    function resize() {
      const w = container!.clientWidth, h = container!.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(container); resize();

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || !container!.clientWidth) { last = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
      const state = live.current, talking = state.speaking && !state.paused;
      const target = talking && state.gesture >= 0 ? GESTURES[state.gesture % GESTURES.length] : IDLE;
      const k = 1 - Math.exp(-dt * 5);
      (Object.keys(IDLE) as Array<keyof Pose>).forEach(key => { pose[key] = lerp(pose[key], target[key], k); });
      const sway = reduced ? 0 : Math.sin(t * 5) * 0.06 * (talking ? 1 : 0);

      droid.right.shoulder.rotation.x = pose.rsx + sway; droid.right.shoulder.rotation.z = pose.rsz;
      droid.right.elbow.rotation.x = pose.rex;
      droid.left.shoulder.rotation.x = pose.lsx + sway; droid.left.shoulder.rotation.z = -pose.lsz;
      droid.left.elbow.rotation.x = pose.lex;

      droid.torso.scale.y = 1 + (reduced ? 0 : Math.sin(t * 1.6) * 0.012);
      droid.head.rotation.y = pose.yaw + (reduced ? 0 : Math.sin(t * 0.5) * 0.1);
      droid.head.rotation.x = reduced ? 0 : (talking ? Math.sin(t * 3.2) * 0.04 : Math.sin(t * 0.8) * 0.015);
      droid.root.rotation.y = reduced ? 0 : Math.sin(t * 0.35) * 0.12;

      // Mouth: speech boundaries give pulses; a steady motion covers voices without them.
      state.pulse = Math.max(0, state.pulse - dt * 6);
      const open = talking ? Math.max(state.pulse, 0.25 + 0.35 * Math.abs(Math.sin(t * 13))) : 0;
      mouth = lerp(mouth, open, 1 - Math.exp(-dt * 25));
      droid.mouth.scale.set(1 - mouth * 0.25, 0.5 + mouth * 5, 1);

      nextBlink -= dt;
      if (nextBlink <= 0) { blink = 0.14; nextBlink = 2.5 + Math.random() * 3; }
      blink = Math.max(0, blink - dt);
      droid.eyes.forEach(e => { e.scale.y = blink > 0 ? 0.12 : 1; });

      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf); observer?.disconnect();
      droid.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [skip, collapsed]);

  if (skip) return null;
  const caption = index >= 0 ? segments[index]?.text : "Press play and the droid will read out the report summary and each widget.";
  const unsupported = !speechSupported || voices.length === 0;
  return <aside className={`cd-droid print:hidden${collapsed ? " cd-droid-collapsed" : ""}`} aria-label="Report read-out presenter">
    <div className="cd-droid-bar">
      <span><Bot size={14} aria-hidden="true" /> Report presenter</span>
      <button type="button" aria-expanded={!collapsed} aria-label={collapsed ? "Expand presenter" : "Collapse presenter"} onClick={() => setCollapsed(c => !c)}><ChevronDown size={14} /></button>
    </div>
    {!collapsed && <>
      <div ref={host} className="cd-droid-stage" data-testid="droid-stage">{!webgl && <p className="cd-droid-fallback">3D view unavailable in this browser. The read-out still works.</p>}</div>
      <p className="cd-droid-caption" data-testid="droid-caption">{caption}</p>
      {unsupported ? <p className="cd-droid-notice" role="status">{!speechSupported ? "This browser does not support speech synthesis." : "No device-local voice is available. Install a local system voice to enable offline speech."} Read the report text instead.</p> : <>
        <div className="cd-droid-controls">
          <button type="button" aria-label="Previous section" onClick={() => skipBy(-1)} disabled={index <= 0 && status === "idle"}><SkipBack size={14} /></button>
          <button type="button" className="cd-droid-play" onClick={toggle}>{status === "speaking" ? <><Pause size={14} /> Pause</> : <><Play size={14} /> {status === "paused" ? "Resume" : "Play read-out"}</>}</button>
          <button type="button" aria-label="Next section" onClick={() => skipBy(1)} disabled={index >= segments.length - 1}><SkipForward size={14} /></button>
          <button type="button" aria-label="Stop read-out" onClick={() => stop()} disabled={status === "idle"}><Square size={14} /></button>
        </div>
        <div className="cd-droid-options">
          <label htmlFor="cd-droid-voice">Voice<select id="cd-droid-voice" value={voiceUri} onChange={e => setVoiceUri(e.target.value)}>
            {voices.length === 0 && <option value="">Browser default</option>}
            {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select></label>
          <label htmlFor="cd-droid-rate">Speed<select id="cd-droid-rate" value={rate} onChange={e => setRate(Number(e.target.value))}>
            {[0.8, 1, 1.15, 1.3].map(r => <option key={r} value={r}>{r}×</option>)}
          </select></label>
        </div>
        {notice && <p className="cd-droid-notice" role="status">{notice}</p>}
      </>}
    </>}
  </aside>;
}
