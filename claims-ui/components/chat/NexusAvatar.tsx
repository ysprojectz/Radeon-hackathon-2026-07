"use client";

/**
 * AXIOM — ACOS Signature Bot Character
 *
 * A distinctive SVG-based AI avatar with:
 * - Geometric LED eyes with blink / scan / focus expressions
 * - Holographic visor strip showing mode-reactive data pulses
 * - Multi-layer orbital ring system with glowing data nodes
 * - Neural particle burst system
 * - Full mode-reactive color, glow, and expression
 *
 * Drop-in replacement for ChatBotIcon — accepts same size/className props.
 * Mode prop drives expression + accent colour.
 */

import { useEffect, useRef, useMemo } from "react";
import type { AvatarMode } from "./BotAvatarCanvas";

// ─── Mode config ──────────────────────────────────────────────────────────────

interface ModeConfig {
  accent: string;
  glow: string;
  eyeState: "open" | "narrow" | "scan" | "wide" | "closed";
  visorPattern: "idle" | "wave" | "flat" | "spike" | "scan";
  orbitSpeed: "slow" | "normal" | "fast" | "frantic";
  pulseRate: number; // 0–1 relative intensity
  label: string;
}

const MODE_CONFIG: Partial<Record<AvatarMode, ModeConfig>> = {
  sentinel:    { accent: "#ff6b00", glow: "rgba(255,107,0,0.6)",   eyeState: "open",   visorPattern: "idle",  orbitSpeed: "normal", pulseRate: 0.5, label: "Sentinel"   },
  neural:      { accent: "#00d8d6", glow: "rgba(0,216,214,0.6)",   eyeState: "wide",   visorPattern: "spike", orbitSpeed: "fast",   pulseRate: 0.9, label: "Neural"     },
  thinking:    { accent: "#fbbf24", glow: "rgba(251,191,36,0.5)",  eyeState: "narrow", visorPattern: "wave",  orbitSpeed: "fast",   pulseRate: 0.7, label: "Thinking"   },
  searching:   { accent: "#fb923c", glow: "rgba(251,146,60,0.5)",  eyeState: "scan",   visorPattern: "scan",  orbitSpeed: "normal", pulseRate: 0.6, label: "Searching"  },
  assisting:   { accent: "#10b981", glow: "rgba(16,185,129,0.5)",  eyeState: "wide",   visorPattern: "wave",  orbitSpeed: "normal", pulseRate: 0.8, label: "Assisting"  },
  monitoring:  { accent: "#22c55e", glow: "rgba(34,197,94,0.5)",   eyeState: "open",   visorPattern: "spike", orbitSpeed: "slow",   pulseRate: 0.5, label: "Monitoring" },
  coding:      { accent: "#4ade80", glow: "rgba(74,222,128,0.5)",  eyeState: "narrow", visorPattern: "wave",  orbitSpeed: "normal", pulseRate: 0.7, label: "Coding"     },
  sleeping:    { accent: "#818cf8", glow: "rgba(129,140,248,0.4)", eyeState: "closed", visorPattern: "flat",  orbitSpeed: "slow",   pulseRate: 0.2, label: "Sleeping"   },
  dreaming:    { accent: "#a78bfa", glow: "rgba(167,139,250,0.4)", eyeState: "closed", visorPattern: "wave",  orbitSpeed: "slow",   pulseRate: 0.3, label: "Dreaming"   },
  celebrating: { accent: "#f472b6", glow: "rgba(244,114,182,0.6)", eyeState: "wide",   visorPattern: "spike", orbitSpeed: "frantic",pulseRate: 1.0, label: "Celebrating"},
  idle:        { accent: "#53f3ff", glow: "rgba(83,243,255,0.4)",  eyeState: "open",   visorPattern: "idle",  orbitSpeed: "slow",   pulseRate: 0.4, label: "Idle"       },
};

function getConfig(mode: AvatarMode): ModeConfig {
  return MODE_CONFIG[mode] ?? {
    accent: "#6366f1", glow: "rgba(99,102,241,0.5)",
    eyeState: "open", visorPattern: "idle", orbitSpeed: "normal", pulseRate: 0.5, label: mode,
  };
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * clamp01(t); }
function easeInOut(t: number) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

// Hex colour → [r,g,b]
function hexToRgb(hex: string): [number,number,number] {
  const h = hex.replace("#","");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgba(hex: string, a: number) {
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── AXIOM draw function ──────────────────────────────────────────────────────

function drawAxiom(
  ctx: CanvasRenderingContext2D,
  t: number,
  cfg: ModeConfig,
  size: number,
  transitionT: number, // 0→1 fade-in for new mode
  prevCfg: ModeConfig,
) {
  const S = size;
  const cx = S / 2, cy = S / 2;
  const sc = S / 80; // scale from base 80px

  ctx.clearRect(0, 0, S, S);

  // ── Blend accent between prev and current config ──
  const [r1,g1,b1] = hexToRgb(prevCfg.accent);
  const [r2,g2,b2] = hexToRgb(cfg.accent);
  const te = easeInOut(transitionT);
  const blendR = Math.round(lerp(r1,r2,te));
  const blendG = Math.round(lerp(g1,g2,te));
  const blendB = Math.round(lerp(b1,b2,te));
  const accent = `rgb(${blendR},${blendG},${blendB})`;
  const accentHex = `#${blendR.toString(16).padStart(2,"0")}${blendG.toString(16).padStart(2,"0")}${blendB.toString(16).padStart(2,"0")}`;

  // ── Orbit speed multipliers ──
  const speedMap = { slow: 0.4, normal: 1.0, fast: 1.8, frantic: 3.2 };
  const spd = lerp(speedMap[prevCfg.orbitSpeed], speedMap[cfg.orbitSpeed], te);

  // ── Pulse intensity ──
  const pRate = lerp(prevCfg.pulseRate, cfg.pulseRate, te);

  // ── 1. Ambient nebula glow (outermost) ──
  const glowR = 36 * sc;
  const glowPulse = 1 + 0.08 * Math.sin(t * 1.8) * pRate;
  const nebula = ctx.createRadialGradient(cx, cy-2*sc, 0, cx, cy, glowR*glowPulse);
  nebula.addColorStop(0, rgba(accentHex, 0.18 * pRate));
  nebula.addColorStop(0.5, rgba(accentHex, 0.06));
  nebula.addColorStop(1, rgba(accentHex, 0));
  ctx.fillStyle = nebula;
  ctx.beginPath(); ctx.ellipse(cx, cy, glowR*1.1*glowPulse, glowR*glowPulse, 0, 0, Math.PI*2); ctx.fill();

  // ── 2. Outer orbital ring (dashed, CCW) ──
  const outerR = 32 * sc;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-t * spd * 0.35);
  ctx.strokeStyle = rgba(accentHex, 0.22 + 0.1 * Math.sin(t * 2.1));
  ctx.lineWidth = 0.8 * sc;
  ctx.setLineDash([3*sc, 4*sc]);
  ctx.beginPath(); ctx.arc(0, 0, outerR, 0, Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);

  // Outer ring: 4 data nodes
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const nx = Math.cos(a) * outerR, ny = Math.sin(a) * outerR;
    const nodeGlow = 0.5 + 0.5 * Math.sin(t * 3.2 + i * 1.57);
    ctx.beginPath(); ctx.arc(nx, ny, 2.2*sc, 0, Math.PI*2);
    const ng = ctx.createRadialGradient(nx,ny,0,nx,ny,3*sc);
    ng.addColorStop(0, rgba(accentHex, 0.9 * nodeGlow));
    ng.addColorStop(1, rgba(accentHex, 0));
    ctx.fillStyle = ng; ctx.fill();
    // node dot centre
    ctx.beginPath(); ctx.arc(nx, ny, 1.1*sc, 0, Math.PI*2);
    ctx.fillStyle = accent; ctx.fill();
  }
  ctx.restore();

  // ── 3. Inner orbital ring (solid, CW) ──
  const innerR = 25 * sc;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * spd * 0.65);
  ctx.strokeStyle = rgba(accentHex, 0.28);
  ctx.lineWidth = 0.7 * sc;
  ctx.beginPath(); ctx.arc(0, 0, innerR, 0, Math.PI*2); ctx.stroke();

  // Inner ring: 3 orbital particles
  const particleColors = [accentHex, "#ffffff", accentHex];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const px = Math.cos(a) * innerR, py = Math.sin(a) * innerR;
    const pGlow = 0.6 + 0.4 * Math.sin(t * 4 + i * 2.09);
    // particle trail
    for (let trail = 0; trail < 5; trail++) {
      const ta = a - (trail * 0.18) / (i + 1);
      const tx2 = Math.cos(ta) * innerR, ty2 = Math.sin(ta) * innerR;
      ctx.beginPath(); ctx.arc(tx2, ty2, (1.8 - trail * 0.25) * sc, 0, Math.PI*2);
      ctx.fillStyle = rgba(particleColors[i], (0.6 - trail * 0.12) * pGlow);
      ctx.fill();
    }
    // bright core
    ctx.beginPath(); ctx.arc(px, py, 2.5*sc, 0, Math.PI*2);
    const pg = ctx.createRadialGradient(px,py,0,px,py,3.5*sc);
    pg.addColorStop(0, rgba(particleColors[i], pGlow));
    pg.addColorStop(1, rgba(particleColors[i], 0));
    ctx.fillStyle = pg; ctx.fill();
    ctx.beginPath(); ctx.arc(px, py, 1.2*sc, 0, Math.PI*2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
  }
  ctx.restore();

  // ── 4. Head body ──
  const hx = cx - 15*sc, hy = cy - 16*sc;
  const hw = 30*sc, hh = 32*sc, hr = 6*sc;

  // head glass background
  const headGrad = ctx.createLinearGradient(hx, hy, hx, hy + hh);
  headGrad.addColorStop(0, "rgba(22,24,38,0.96)");
  headGrad.addColorStop(1, "rgba(12,14,26,0.98)");
  ctx.fillStyle = headGrad;
  roundRect(ctx, hx, hy, hw, hh, hr);
  ctx.fill();

  // head border glow
  const borderGlow = ctx.createLinearGradient(hx, hy, hx+hw, hy+hh);
  borderGlow.addColorStop(0, rgba(accentHex, 0.5 + 0.25 * Math.sin(t * 2.4)));
  borderGlow.addColorStop(0.5, rgba(accentHex, 0.15));
  borderGlow.addColorStop(1, rgba(accentHex, 0.4));
  ctx.strokeStyle = borderGlow;
  ctx.lineWidth = 1.2 * sc;
  roundRect(ctx, hx, hy, hw, hh, hr);
  ctx.stroke();

  // subtle inner hex-grid texture
  ctx.save();
  ctx.beginPath(); roundRect(ctx, hx, hy, hw, hh, hr); ctx.clip();
  drawHexGrid(ctx, hx, hy, hw, hh, sc, accentHex);
  ctx.restore();

  // ── 5. Antenna ──
  const antX = cx, antY = hy - 6*sc;
  const antPulse = 0.5 + 0.5 * Math.sin(t * 3.5) * pRate;
  ctx.strokeStyle = rgba(accentHex, 0.45);
  ctx.lineWidth = 1*sc;
  ctx.beginPath(); ctx.moveTo(antX, hy); ctx.lineTo(antX, antY + 2*sc); ctx.stroke();
  // antenna cap
  const ag = ctx.createRadialGradient(antX, antY, 0, antX, antY, 4*sc);
  ag.addColorStop(0, rgba(accentHex, 0.9 * antPulse));
  ag.addColorStop(1, rgba(accentHex, 0));
  ctx.fillStyle = ag;
  ctx.beginPath(); ctx.arc(antX, antY, 4*sc, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath(); ctx.arc(antX, antY, 1.8*sc, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(antX, antY, 0.8*sc, 0, Math.PI*2); ctx.fill();

  // ── 6. Eyes ──
  const blendEyeState = te > 0.5 ? cfg.eyeState : prevCfg.eyeState;
  const eyeY = hy + 10*sc;
  const eyeW = 8*sc, eyeH = getEyeHeight(blendEyeState, t) * sc;
  const eyeR = Math.min(eyeW, eyeH) / 2;
  const lEyeX = cx - 8*sc - eyeW/2;
  const rEyeX = cx + 8*sc - eyeW/2;

  // scan offset for "scan" mode
  const scanOff = blendEyeState === "scan" ? Math.sin(t * 3.5) * 2 * sc : 0;

  for (let eye = 0; eye < 2; eye++) {
    const ex = (eye === 0 ? lEyeX : rEyeX) + scanOff;
    const ey = eyeY - eyeH/2;

    // eye socket background
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    roundRect(ctx, ex, ey, eyeW, eyeH, eyeR);
    ctx.fill();

    // iris glow fill
    const irisGrad = ctx.createLinearGradient(ex, ey, ex, ey + eyeH);
    irisGrad.addColorStop(0, rgba(accentHex, 0.85));
    irisGrad.addColorStop(0.5, rgba(accentHex, 0.55));
    irisGrad.addColorStop(1, rgba(accentHex, 0.3));
    ctx.fillStyle = irisGrad;
    roundRect(ctx, ex+0.8*sc, ey+0.8*sc, eyeW-1.6*sc, eyeH-1.6*sc, eyeR*0.7);
    ctx.fill();

    // pupil / reflection
    if (blendEyeState !== "closed") {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.ellipse(ex + eyeW*0.5, ey + eyeH*0.52, eyeW*0.18, eyeH*0.35, 0, 0, Math.PI*2);
      ctx.fill();
      // specular
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.ellipse(ex + eyeW*0.3, ey + eyeH*0.28, eyeW*0.1, eyeH*0.14, -0.3, 0, Math.PI*2);
      ctx.fill();
    }

    // eye border
    ctx.strokeStyle = rgba(accentHex, 0.7 + 0.3 * Math.sin(t*2.8 + eye));
    ctx.lineWidth = 0.9 * sc;
    roundRect(ctx, ex, ey, eyeW, eyeH, eyeR);
    ctx.stroke();

    // blink flash
    if (blendEyeState === "wide") {
      const bFlash = 0.3 + 0.3 * Math.sin(t * 5.5);
      ctx.strokeStyle = rgba(accentHex, bFlash);
      ctx.lineWidth = 0.5 * sc;
      roundRect(ctx, ex - 1.5*sc, ey - 1.5*sc, eyeW + 3*sc, eyeH + 3*sc, eyeR + 1.5*sc);
      ctx.stroke();
    }
  }

  // ── 7. Visor data strip ──
  const vx = hx + 3*sc, vy = hy + hh - 12*sc;
  const vw = hw - 6*sc, vh = 4.5*sc;
  const blendVisor = te > 0.5 ? cfg.visorPattern : prevCfg.visorPattern;

  ctx.save();
  ctx.beginPath(); roundRect(ctx, vx, vy, vw, vh, 1.5*sc); ctx.clip();

  // visor bg
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(vx, vy, vw, vh);

  // data bars
  const bars = 14;
  for (let b = 0; b < bars; b++) {
    const bx = vx + (b / bars) * vw;
    const bw = (vw / bars) * 0.65;
    const bh = getBarHeight(blendVisor, b, bars, t, pRate) * vh;
    ctx.fillStyle = rgba(accentHex, 0.55 + 0.35 * (bh / vh));
    ctx.fillRect(bx, vy + vh - bh, bw, bh);
  }

  // visor scan line
  if (blendVisor === "scan") {
    const sl = ((t * 0.8) % 1) * (vw + 4*sc) - 2*sc;
    const slg = ctx.createLinearGradient(vx + sl - 4*sc, vy, vx + sl + 2*sc, vy);
    slg.addColorStop(0, rgba(accentHex, 0));
    slg.addColorStop(0.5, rgba(accentHex, 0.9));
    slg.addColorStop(1, rgba(accentHex, 0));
    ctx.fillStyle = slg;
    ctx.fillRect(vx + sl - 4*sc, vy, 6*sc, vh);
  }
  ctx.restore();

  // visor border
  ctx.strokeStyle = rgba(accentHex, 0.4);
  ctx.lineWidth = 0.7 * sc;
  roundRect(ctx, vx, vy, vw, vh, 1.5*sc);
  ctx.stroke();

  // ── 8. Status LED row (below eyes, above visor) ──
  const ledY = hy + 20*sc;
  const ledSpacing = vw / 4;
  for (let l = 0; l < 3; l++) {
    const lx = vx + ledSpacing * (l + 0.5);
    const ledOn = Math.sin(t * (2.5 + l * 0.7) + l * 1.2) > 0.3 - pRate;
    const ledA = ledOn ? 0.8 : 0.18;
    ctx.beginPath(); ctx.arc(lx, ledY, 1.3*sc, 0, Math.PI*2);
    ctx.fillStyle = rgba(accentHex, ledA);
    ctx.fill();
    if (ledOn) {
      const lg = ctx.createRadialGradient(lx,ledY,0,lx,ledY,3*sc);
      lg.addColorStop(0, rgba(accentHex, 0.35));
      lg.addColorStop(1, rgba(accentHex, 0));
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lx, ledY, 3*sc, 0, Math.PI*2); ctx.fill();
    }
  }

  // ── 9. Neural burst particles (neural/celebrating/thinking) ──
  if (pRate > 0.65) {
    for (let p = 0; p < 6; p++) {
      const pa = (p / 6) * Math.PI * 2 + t * 0.7;
      const phase = ((t * 1.5 + p * 0.4) % 1);
      const pd = phase * 18 * sc;
      const px2 = cx + Math.cos(pa) * pd;
      const py2 = cy + Math.sin(pa) * pd;
      const alpha = (1 - phase) * 0.5 * pRate;
      const pr = (1 - phase * 0.6) * 1.8 * sc;
      ctx.beginPath(); ctx.arc(px2, py2, pr, 0, Math.PI*2);
      ctx.fillStyle = rgba(accentHex, alpha);
      ctx.fill();
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawHexGrid(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, sc: number, accent: string) {
  const hexR = 5 * sc;
  const cols = Math.ceil(w / (hexR * 1.7)) + 2;
  const rows = Math.ceil(h / (hexR * 1.5)) + 2;
  ctx.strokeStyle = rgba(accent, 0.06);
  ctx.lineWidth = 0.5 * sc;
  for (let row = -1; row < rows; row++) {
    for (let col = -1; col < cols; col++) {
      const hx = ox + col * hexR * 1.732 + (row % 2) * hexR * 0.866;
      const hy = oy + row * hexR * 1.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 - Math.PI / 6;
        const vx = hx + Math.cos(a) * hexR * 0.8;
        const vy = hy + Math.sin(a) * hexR * 0.8;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath(); ctx.stroke();
    }
  }
}

function getEyeHeight(state: ModeConfig["eyeState"], t: number): number {
  switch (state) {
    case "open":   return 5 + 0.3 * Math.sin(t * 0.4);
    case "wide":   return 6.5 + 0.4 * Math.sin(t * 3.8);
    case "narrow": return 2.8 + 0.2 * Math.sin(t * 2.2);
    case "scan":   return 3.2;
    case "closed": return 1.2 + 0.3 * Math.abs(Math.sin(t * 0.8));
    default:       return 5;
  }
}

function getBarHeight(pattern: ModeConfig["visorPattern"], b: number, bars: number, t: number, intensity: number): number {
  const pos = b / bars;
  switch (pattern) {
    case "wave":   return 0.15 + 0.7 * Math.abs(Math.sin(pos * Math.PI * 2 + t * 4)) * intensity;
    case "spike":  return 0.1 + 0.85 * Math.abs(Math.sin(pos * Math.PI * 3 + t * 5)) * intensity;
    case "flat":   return 0.15 + 0.05 * Math.sin(pos * 5 + t);
    case "scan": {
      const scanPos = (t * 0.6) % 1;
      const dist = Math.abs(pos - scanPos);
      return 0.1 + 0.8 * Math.exp(-dist * 12) * intensity;
    }
    case "idle":
    default:       return 0.15 + 0.3 * Math.abs(Math.sin(pos * Math.PI * 1.5 + t * 1.8)) * intensity;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface NexusAvatarProps {
  mode?: AvatarMode;
  size?: number;
  className?: string;
}

export function NexusAvatar({ mode = "sentinel", size = 80, className }: NexusAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const startRef  = useRef<number>(0);
  const modeRef   = useRef<AvatarMode>(mode);
  const prevCfgRef = useRef<ModeConfig>(getConfig(mode));
  const transRef   = useRef<number>(1); // 1 = fully transitioned to current mode
  const transDurRef = useRef<number>(0.6); // seconds

  // When mode changes, start a transition from prevCfg → newCfg
  useEffect(() => {
    if (modeRef.current !== mode) {
      prevCfgRef.current = getConfig(modeRef.current);
      transRef.current = 0;
      modeRef.current = mode;
    }
  }, [mode]);

  const cfg = useMemo(() => getConfig(mode), [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let animId: number;
    const ctxNonNull = ctx;
    function tick(now: number) {
      if (!startRef.current) startRef.current = now;
      const t = (now - startRef.current) / 1000;

      // advance transition
      if (transRef.current < 1) {
        transRef.current = Math.min(1, transRef.current + (1 / 60) / transDurRef.current);
      }

      drawAxiom(ctxNonNull, t, cfg, size, transRef.current, prevCfgRef.current);
      animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
    rafRef.current = animId;
    return () => cancelAnimationFrame(animId);
  }, [cfg, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={className}
      aria-label={`AXIOM — ${cfg.label}`}
      role="img"
    />
  );
}

// ── Size variants ──────────────────────────────────────────────────────────────

export function NexusAvatarSmall({ mode, className }: { mode?: AvatarMode; className?: string }) {
  return <NexusAvatar mode={mode} size={32} className={className} />;
}
export function NexusAvatarMedium({ mode, className }: { mode?: AvatarMode; className?: string }) {
  return <NexusAvatar mode={mode} size={56} className={className} />;
}
export function NexusAvatarLarge({ mode, className }: { mode?: AvatarMode; className?: string }) {
  return <NexusAvatar mode={mode} size={120} className={className} />;
}
