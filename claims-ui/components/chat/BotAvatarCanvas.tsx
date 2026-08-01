"use client";
/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────
export type AvatarMode =
  | "crabcrawl"
  | "explorer" | "hacker" | "artist" | "chef" | "rockstar"
  | "astronaut" | "gardener" | "superhero" | "party"
  | "idle" | "cycling" | "coding" | "swimming" | "thinking"
  | "searching" | "exercising" | "meditate"
  | "ninja" | "sleeping" | "dreaming" | "reading" | "writing"
  | "flying" | "celebrating" | "skating" | "yoga" | "presenting"
  | "moonwalk" | "dancing" | "listening"
  | "professor" | "monitoring" | "relaxing"
  | "assisting"
  | "orangerobot"
  | "sentinel"
  | "neural"
  | "chatboticon"; // Enhanced custom GIF chatbot icon

export const MODE_SEQUENCE: AvatarMode[] = [
  "sentinel",
  "neural",
  "searching", "coding", "ninja", "sleeping", "dreaming", "thinking",
  "celebrating", "monitoring", "assisting",
  "chatboticon", // Include enhanced icon in rotation
];

export const MODE_META: Record<AvatarMode, {
  accent: string; shadow: string; bg: string; hoverShadow: string; label: string; emoji: string;
}> = {
  crabcrawl:   { accent: "#f97316", shadow: "rgba(249,115,22,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(249,115,22,.32)",   label: "Crab Crawl",  emoji: "↔" },
  explorer:    { accent: "#22d3ee", shadow: "rgba(34,211,238,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(34,211,238,.32)",   label: "Explorer",    emoji: "🧭" },
  hacker:      { accent: "#22c55e", shadow: "rgba(34,197,94,0.42)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(34,197,94,.32)",    label: "Hacker",      emoji: "⌨" },
  artist:      { accent: "#a855f7", shadow: "rgba(168,85,247,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(168,85,247,.32)",   label: "Artist",      emoji: "🎨" },
  chef:        { accent: "#f97316", shadow: "rgba(249,115,22,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(249,115,22,.32)",   label: "Chef",        emoji: "🍳" },
  rockstar:    { accent: "#ec4899", shadow: "rgba(236,72,153,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(236,72,153,.32)",   label: "Rock Star",   emoji: "🎸" },
  astronaut:   { accent: "#60a5fa", shadow: "rgba(96,165,250,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(96,165,250,.32)",   label: "Astronaut",   emoji: "🚀" },
  gardener:    { accent: "#84cc16", shadow: "rgba(132,204,22,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(132,204,22,.32)",   label: "Gardener",    emoji: "🌱" },
  superhero:   { accent: "#06b6d4", shadow: "rgba(6,182,212,0.42)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(6,182,212,.32)",    label: "Superhero",   emoji: "⚡" },
  party:       { accent: "#facc15", shadow: "rgba(250,204,21,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(250,204,21,.32)",   label: "Party Bot",   emoji: "🎉" },
  idle:        { accent: "#53f3ff", shadow: "rgba(83,243,255,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(83,243,255,.32)",   label: "Idle",        emoji: "✦" },
  cycling:     { accent: "#a3e635", shadow: "rgba(163,230,53,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(163,230,53,.32)",   label: "Cycling",     emoji: "⚙" },
  coding:      { accent: "#4ade80", shadow: "rgba(74,222,128,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(74,222,128,.32)",   label: "Coding",      emoji: "⌨" },
  swimming:    { accent: "#38bdf8", shadow: "rgba(56,189,248,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(56,189,248,.32)",   label: "Swimming",    emoji: "〜" },
  thinking:    { accent: "#fbbf24", shadow: "rgba(251,191,36,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(251,191,36,.32)",   label: "Thinking",    emoji: "💭" },
  searching:   { accent: "#fb923c", shadow: "rgba(251,146,60,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(251,146,60,.32)",   label: "Searching",   emoji: "🔍" },
  exercising:  { accent: "#fb7185", shadow: "rgba(251,113,133,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(251,113,133,.32)",  label: "Exercising",  emoji: "💪" },
  meditate:    { accent: "#c084fc", shadow: "rgba(192,132,252,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(192,132,252,.32)",  label: "Meditating",  emoji: "☯" },
  ninja:       { accent: "#64748b", shadow: "rgba(100,116,139,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(100,116,139,.32)",  label: "Ninja",       emoji: "⚡" },
  sleeping:    { accent: "#818cf8", shadow: "rgba(129,140,248,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(129,140,248,.32)",  label: "Sleeping",    emoji: "💤" },
  dreaming:    { accent: "#a78bfa", shadow: "rgba(167,139,250,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(167,139,250,.32)",  label: "Dreaming",    emoji: "🌙" },
  reading:     { accent: "#2dd4bf", shadow: "rgba(45,212,191,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(45,212,191,.32)",   label: "Reading",     emoji: "📖" },
  writing:     { accent: "#facc15", shadow: "rgba(250,204,21,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(250,204,21,.32)",   label: "Writing",     emoji: "✍" },
  flying:      { accent: "#60a5fa", shadow: "rgba(96,165,250,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(96,165,250,.32)",   label: "Flying",      emoji: "🚀" },
  celebrating: { accent: "#f472b6", shadow: "rgba(244,114,182,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(244,114,182,.32)",  label: "Celebrating", emoji: "🎉" },
  skating:     { accent: "#67e8f9", shadow: "rgba(103,232,249,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(103,232,249,.32)",  label: "Skating",     emoji: "⛸" },
  yoga:        { accent: "#a78bfa", shadow: "rgba(167,139,250,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(167,139,250,.32)",  label: "Yoga",        emoji: "🧘" },
  presenting:  { accent: "#34d399", shadow: "rgba(52,211,153,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(52,211,153,.32)",   label: "Presenting",  emoji: "📊" },
  moonwalk:    { accent: "#f0abfc", shadow: "rgba(240,171,252,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(240,171,252,.32)",  label: "Moonwalking", emoji: "🎶" },
  dancing:     { accent: "#f472b6", shadow: "rgba(244,114,182,0.42)",  bg: "transparent", hoverShadow: "0 12px 40px rgba(244,114,182,.32)",  label: "Dancing",     emoji: "💃" },
  listening:   { accent: "#22d3ee", shadow: "rgba(34,211,238,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(34,211,238,.32)",   label: "Listening",   emoji: "🎧" },
  professor:   { accent: "#f59e0b", shadow: "rgba(245,158,11,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(245,158,11,.32)",   label: "Professor",   emoji: "🎓" },
  monitoring:  { accent: "#22c55e", shadow: "rgba(34,197,94,0.42)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(34,197,94,.32)",    label: "Monitoring",  emoji: "📡" },
   relaxing:    { accent: "#fbbf24", shadow: "rgba(251,191,36,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(251,191,36,.32)",   label: "Relaxing",    emoji: "😎" },
   assisting:   { accent: "#10b981", shadow: "rgba(16,185,129,0.42)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(16,185,129,.32)",   label: "Assisting",   emoji: "🤝" },
   orangerobot: { accent: "#ff6b00", shadow: "rgba(255,107,0,0.42)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(255,107,0,.32)",    label: "Orange Bot",  emoji: "🤖" },
   sentinel:    { accent: "#ff6b00", shadow: "rgba(255,107,0,0.45)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(255,107,0,.38)",    label: "Sentinel",    emoji: "◈" },
   neural:      { accent: "#00d8d6", shadow: "rgba(0,216,214,0.45)",    bg: "transparent", hoverShadow: "0 12px 40px rgba(0,216,214,.38)",    label: "Neural",      emoji: "🧠" },
   chatboticon: { accent: "#06b6d4", shadow: "rgba(6,182,212,0.45)",   bg: "transparent", hoverShadow: "0 12px 40px rgba(6,182,212,.38)",   label: "Chat Bot",    emoji: "💬" },
 };

const BASE_SIZE = 80;
const TRANSITION_MS = 520;

// ─── Utilities ────────────────────────────────────────────────────────────────
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function ease(v: number) { const x = clamp01(v); return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x+2,3)/2; }
function pulse(t: number, spd: number, ph = 0) { return Math.sin(t * spd + ph); }
function drand(s: number) { const x = Math.sin(s*127.1+311.7)*43758.5453; return x - Math.floor(x); }

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

// ─── Background Glow ─────────────────────────────────────────────────────────
function glow(ctx: CanvasRenderingContext2D, t: number, accent: string, cx=40, cy=45) {
  const g = ctx.createRadialGradient(cx,cy,0,cx,cy,38+pulse(t,1.4)*3);
  g.addColorStop(0,`${accent}4d`); g.addColorStop(.42,`${accent}22`); g.addColorStop(1,`${accent}00`);
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,42,0,Math.PI*2); ctx.fill();
}

// ─── Space Ambient Dust ───────────────────────────────────────────────────────
function drawSpaceDust(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  for (let i=0;i<9;i++) {
    const a = t*(.4+i*.07)+i*2.3;
    const r = 18+drand(i*7)*20;
    const sx = 40+Math.cos(a)*r, sy = 38+Math.sin(a*.85)*r*.6;
    ctx.globalAlpha = .15+.12*pulse(t,1.1,i);
    ctx.fillStyle = i%3===0?accent:i%3===1?"#ffffff":"#93c5fd";
    ctx.beginPath(); ctx.arc(sx,sy,.8+drand(i*3)*.8,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// ─── Thruster Puffs ───────────────────────────────────────────────────────────
function drawThrusterPuff(ctx: CanvasRenderingContext2D, t: number, x: number, y: number, dir: number, accent: string) {
  for (let i=0;i<4;i++) {
    const age = ((t*6+i*.8)%1);
    const px = x + Math.cos(dir)*age*14 + pulse(t,8,i)*.8;
    const py = y + Math.sin(dir)*age*14;
    ctx.globalAlpha = (1-age)*.5;
    ctx.fillStyle = i<2 ? accent : "#ffffff";
    ctx.beginPath(); ctx.arc(px,py,2-age*1.5,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// ─── Starfield ────────────────────────────────────────────────────────────────
function drawStarField(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const stars=[[8,12],[16,6],[60,8],[70,15],[72,5],[55,19],[25,18],[65,22],[12,24],[75,10],[45,7],[32,14]];
  stars.forEach(([sx,sy],i)=>{
    const tw=.4+.6*(.5+.5*pulse(t,1.2+i*.3,i*1.7));
    ctx.globalAlpha=tw;
    ctx.fillStyle=i%3===0?accent:i%3===1?"#ffffff":"#e0d4ff";
    const sz=1+(i%3)*.8;
    ctx.beginPath(); ctx.arc(sx,sy,sz,0,Math.PI*2); ctx.fill();
    if(i%4===0){
      ctx.strokeStyle=i%3===0?accent:"#ffffff"; ctx.lineWidth=.6;
      ctx.beginPath(); ctx.moveTo(sx-sz*2,sy); ctx.lineTo(sx+sz*2,sy);
      ctx.moveTo(sx,sy-sz*2); ctx.lineTo(sx,sy+sz*2); ctx.stroke();
    }
  });
  ctx.globalAlpha=1;
}

// ─── Moon ─────────────────────────────────────────────────────────────────────
function drawMoon(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const mx=63,my=12,mr=9, wb=pulse(t,.6)*.5;
  ctx.save(); ctx.translate(mx,my+wb);
  ctx.fillStyle=accent; ctx.globalAlpha=.85;
  ctx.beginPath(); ctx.arc(0,0,mr,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation="destination-out";
  ctx.beginPath(); ctx.arc(4,-2,mr-2,0,Math.PI*2); ctx.fill();
  ctx.globalCompositeOperation="source-over";
  const g=ctx.createRadialGradient(-2,-2,0,-2,-2,mr);
  g.addColorStop(0,"rgba(255,255,220,.6)"); g.addColorStop(1,`${accent}00`);
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(-2,-2,mr,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1; ctx.restore();
}

// ─── Dream Bubble ─────────────────────────────────────────────────────────────
function drawDreamBubble(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const fl=pulse(t,.8)*2;
  ctx.save(); ctx.translate(14,20+fl);
  [[-8,14,2.5],[-4,8,3.5],[0,3,2]].forEach(([dx,dy,dr])=>{
    ctx.fillStyle=`${accent}40`; ctx.beginPath(); ctx.arc(dx,dy,dr,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=`${accent}80`; ctx.lineWidth=.8; ctx.beginPath(); ctx.arc(dx,dy,dr,0,Math.PI*2); ctx.stroke();
  });
  ctx.fillStyle=`${accent}28`; ctx.strokeStyle=`${accent}90`; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.ellipse(0,-8,14,12,0,0,Math.PI*2); ctx.fill(); ctx.stroke();
  [[-7,-10,"★"],[2,-7,"♥"],[-2,-14,"✦"]].forEach(([ix,iy,ic],idx)=>{
    const ang=t*(idx%2===0?.8:-.6)+idx*2.1;
    ctx.save(); ctx.translate(ix as number,iy as number); ctx.rotate(ang);
    ctx.fillStyle=idx===1?"#ff8fa3":"#ffffff"; ctx.globalAlpha=.7+.3*pulse(t,2,idx);
    ctx.font=`${6+idx}px sans-serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(ic as string,0,0); ctx.restore();
  });
  ctx.globalAlpha=1; ctx.restore();
}

// ─── Zzz ──────────────────────────────────────────────────────────────────────
function drawZzz(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ctx.textAlign="center";
  [["z",52,9],["Z",57,11],["Z",63,14]].forEach(([ch,x,fs],i)=>{
    const rise=((t*8+i*10)%32);
    ctx.globalAlpha=clamp01(1-rise/34)*(.6+i*.15);
    ctx.fillStyle=i===2?"#ffffff":accent;
    ctx.font=`800 ${fs}px sans-serif`;
    ctx.fillText(ch as string,x as number,46-rise);
  });
  ctx.globalAlpha=1;
}

// ─── Radar Sweep ──────────────────────────────────────────────────────────────
function drawRadarSweep(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const cx=40,cy=40,r=34;
  ctx.strokeStyle=`${accent}25`; ctx.lineWidth=.8;
  [.33,.66,1].forEach(s=>{ ctx.beginPath(); ctx.arc(cx,cy,r*s,0,Math.PI*2); ctx.stroke(); });
  ctx.beginPath(); ctx.moveTo(cx-r,cy); ctx.lineTo(cx+r,cy); ctx.moveTo(cx,cy-r); ctx.lineTo(cx,cy+r); ctx.stroke();
  const sw=t*2.5;
  for(let a=0;a<1.1;a+=.05){
    ctx.globalAlpha=(1.1-a)*.35; ctx.strokeStyle=accent; ctx.lineWidth=1.5+(1.1-a)*2;
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,r,sw-a,sw-a+.06); ctx.lineTo(cx,cy); ctx.stroke();
  }
  ctx.globalAlpha=1; ctx.strokeStyle=accent; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+Math.cos(sw)*r,cy+Math.sin(sw)*r); ctx.stroke();
  const pp=(t*.7)%1;
  if(pp>.5){ const pr=4+(pp-.5)*20, pa=clamp01(1-(pp-.5)*2);
    ctx.globalAlpha=pa*.8; ctx.strokeStyle="#ffffff"; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.arc(cx+14,cy-10,pr,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1; ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.arc(cx+14,cy-10,2,0,Math.PI*2); ctx.fill();
  }
}

// ─── Shuriken ─────────────────────────────────────────────────────────────────
function drawShuriken(ctx: CanvasRenderingContext2D, t: number, accent: string, cx: number, cy: number) {
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(t*4.5);
  for(let i=0;i<4;i++){
    ctx.save(); ctx.rotate((Math.PI*2/4)*i);
    ctx.fillStyle=i%2===0?accent:"rgba(255,255,255,.85)";
    ctx.beginPath(); ctx.moveTo(0,-1); ctx.bezierCurveTo(2,-5,7,-9,0,-12);
    ctx.bezierCurveTo(-7,-9,-2,-5,0,-1); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ─── Afterimages (astronaut ghost clones) ────────────────────────────────────
function drawAfterImages(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  for(let i=0;i<3;i++){
    const off=(i+1)*7;
    ctx.globalAlpha=.08-i*.02;
    const grd=ctx.createRadialGradient(40-off,40,0,40-off,40,20);
    grd.addColorStop(0,accent); grd.addColorStop(1,`${accent}00`);
    ctx.fillStyle=grd; ctx.beginPath(); ctx.ellipse(40-off,40,14,20,pulse(t,6+i,i)*.15,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// ─── Mandala ──────────────────────────────────────────────────────────────────
function drawMandala(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const cx=40,cy=42;
  for(let i=0;i<4;i++){
    const rt=((t*.22+i*.25)%1);
    ctx.globalAlpha=(1-rt)*.5; ctx.strokeStyle=i%2===0?accent:`${accent}99`; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.ellipse(cx,cy,12+rt*30,8+rt*18,0,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha=1;
  for(let i=0;i<8;i++){
    const ang=(Math.PI*2/8)*i+t*.12, pr=20+pulse(t,.8,i)*1.5;
    ctx.save(); ctx.translate(cx,cy); ctx.rotate(ang);
    ctx.globalAlpha=.18; ctx.strokeStyle=accent; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.ellipse(0,-pr/2,3,pr/2,0,0,Math.PI*2); ctx.stroke(); ctx.restore();
  }
  ctx.globalAlpha=1;
}

function drawLotusSeat(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const breathe = pulse(t, .7) * 1.4;
  ctx.save();
  ctx.translate(40, 64 + breathe);
  for (let ring = 0; ring < 2; ring++) {
    const petals = ring === 0 ? 8 : 6;
    const radius = ring === 0 ? 18 : 12;
    for (let i = 0; i < petals; i++) {
      const angle = (Math.PI * 2 / petals) * i + ring * .34;
      ctx.save();
      ctx.rotate(angle);
      ctx.globalAlpha = ring === 0 ? .32 : .45;
      ctx.fillStyle = i % 2 === 0 ? accent : "#ffffff";
      ctx.beginPath();
      ctx.ellipse(0, -radius, 4.8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = .5;
  ctx.fillStyle = `${accent}55`;
  ctx.beginPath();
  ctx.ellipse(0, 3, 24, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawNinjaSlash(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const sweep = (t * 3.8) % 1;
  ctx.save();
  ctx.translate(40, 40);
  ctx.rotate(-.45 + pulse(t, 5) * .08);
  ctx.globalAlpha = .2 + .55 * (1 - Math.abs(sweep - .5) * 2);
  const grad = ctx.createLinearGradient(-38, 0, 38, 0);
  grad.addColorStop(0, `${accent}00`);
  grad.addColorStop(.45, `${accent}dd`);
  grad.addColorStop(.55, "#ffffff");
  grad.addColorStop(1, `${accent}00`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-34 + sweep * 12, 19);
  ctx.quadraticCurveTo(0, -22, 34 - sweep * 12, -16);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ─── Third Eye ────────────────────────────────────────────────────────────────
function drawThirdEye(ctx: CanvasRenderingContext2D, cx: number, cy: number, t: number, accent: string) {
  const p=.5+.5*pulse(t,1.8);
  const g=ctx.createRadialGradient(cx,cy,0,cx,cy,5*p);
  g.addColorStop(0,"#ffffff"); g.addColorStop(.5,accent); g.addColorStop(1,`${accent}00`);
  ctx.globalAlpha=.9*p; ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,5*p,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1; ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.arc(cx,cy,1.5,0,Math.PI*2); ctx.fill();
}

// ─── Equalizer ────────────────────────────────────────────────────────────────
function drawEqualizer(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const bars=7,bw=5,gap=2,totalW=bars*(bw+gap)-gap,startX=(80-totalW)/2,baseY=76;
  for(let i=0;i<bars;i++){
    const h=5+14*(.5+.5*pulse(t,3+i*.5,i*.9)), x=startX+i*(bw+gap);
    const g=ctx.createLinearGradient(0,baseY-h,0,baseY);
    g.addColorStop(0,accent); g.addColorStop(1,`${accent}55`);
    ctx.fillStyle=g; rr(ctx,x,baseY-h,bw,h,1.5); ctx.fill();
  }
}

// ─── Music Notes ──────────────────────────────────────────────────────────────
function drawMusicNotes(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ["♪","♩","♫","♬"].forEach((note,i)=>{
    const rise=((t*4+i*3.1)%22), xo=Math.sin(t*1.3+i*1.6)*5;
    ctx.globalAlpha=clamp01(1-rise/24)*.85;
    ctx.fillStyle=i%2===0?accent:"#ffffff";
    ctx.font=`${9+i%2*2}px sans-serif`; ctx.textAlign="center";
    ctx.fillText(note,22+i*14+xo,58-rise);
  });
  ctx.globalAlpha=1;
}

// ─── Knowledge Symbols ────────────────────────────────────────────────────────
function drawKnowledgeSymbols(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ["∑","∞","√","π","∆","≈"].forEach((sym,i)=>{
    const ang=t*.4+i*1.257, rx=29+pulse(t,.5,i)*3, ry=20+pulse(t,.7,i*.8)*3;
    const sx=40+Math.cos(ang)*rx, sy=38+Math.sin(ang)*ry;
    ctx.globalAlpha=.4+.35*pulse(t,1.2,i);
    ctx.fillStyle=i%2===0?accent:"#ffffff";
    ctx.font=`bold ${7+i%2*2}px serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(sym,sx,sy);
  });
  ctx.globalAlpha=1;
}

// ─── Chalkboard ───────────────────────────────────────────────────────────────
function drawChalkboard(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ctx.fillStyle="#0f172a"; rr(ctx,5,10,32,24,3); ctx.fill();
  ctx.strokeStyle="#78350f"; ctx.lineWidth=2.5; rr(ctx,5,10,32,24,3); ctx.stroke();
  ctx.fillStyle="#14532d"; rr(ctx,7,12,28,20,2); ctx.fill();
  [{ text:"E=mc²", x:10, y:19, c:"rgba(255,255,255,.8)" },
   { text:"∑∞",   x:13, y:26, c:`${accent}cc` }].forEach(({text,x,y,c})=>{
    ctx.globalAlpha=Math.min(clamp01(t%4/1.5),.9);
    ctx.fillStyle=c; ctx.font="bold 6px monospace"; ctx.textAlign="left"; ctx.fillText(text,x,y);
  });
  ctx.globalAlpha=1;
  for(let i=0;i<3;i++){
    const px=28+i*4+pulse(t,3,i)*2, py=28+pulse(t,2,i)*3;
    ctx.globalAlpha=.3+.2*pulse(t,4,i); ctx.fillStyle="#ffffff";
    ctx.beginPath(); ctx.arc(px,py,.8,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;
}

// ─── Monitor Screens ──────────────────────────────────────────────────────────
function drawMonitorScreens(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  [{x:4,y:12,w:22,h:16},{x:54,y:14,w:22,h:16},{x:22,y:58,w:36,h:14}].forEach((s,idx)=>{
    const fl=pulse(t,.8+idx*.3,idx)*1.5;
    ctx.save(); ctx.translate(0,fl);
    ctx.fillStyle="#0f172a"; rr(ctx,s.x-1,s.y-1,s.w+2,s.h+2,2.5); ctx.fill();
    ctx.fillStyle="#021710"; rr(ctx,s.x,s.y,s.w,s.h,2); ctx.fill();
    const lc=Math.floor(s.h/4);
    for(let i=0;i<lc;i++){
      const lw=drand(idx*10+i)*(s.w-6)+3;
      ctx.globalAlpha=.5+.4*pulse(t,3,i);
      ctx.fillStyle=i%3===0?accent:i%3===1?"#22c55e":"#ffffff";
      ctx.fillRect(s.x+2,s.y+3+i*4,lw,1.2);
    }
    ctx.globalAlpha=.4+.3*pulse(t,1.5,idx); ctx.strokeStyle=accent; ctx.lineWidth=.8;
    rr(ctx,s.x,s.y,s.w,s.h,2); ctx.stroke();
    if(idx===0&&((t*2)%1)>.6){
      ctx.fillStyle="#ef4444"; ctx.globalAlpha=.9;
      ctx.beginPath(); ctx.arc(s.x+s.w-3,s.y+3,2,0,Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha=1; ctx.restore();
  });
}

// ─── Binary Rain ──────────────────────────────────────────────────────────────
function drawBinaryRain(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ["0","1","A","F","3","7","E","B"].forEach((_, ci) => {
    if(ci>=4)return;
    const col=[15,28,50,65][ci];
    for(let i=0;i<3;i++){
      const y=((t*18+ci*7+i*9)%55)+5;
      ctx.globalAlpha=clamp01(1-y/60)*.5;
      ctx.fillStyle=ci===1?accent:"#22c55e";
      ctx.font="bold 6px monospace"; ctx.textAlign="center";
      ctx.fillText(["0","1","A","F","3","7","E","B"][(ci+i+Math.floor(t*2))%8],col,y);
    }
  });
  ctx.globalAlpha=1;
}

// ─── Terminal ─────────────────────────────────────────────────────────────────
function drawTerminal(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ctx.fillStyle="#0d1117"; rr(ctx,8,54,64,20,4); ctx.fill();
  ctx.strokeStyle=`${accent}60`; ctx.lineWidth=1; rr(ctx,8,54,64,20,4); ctx.stroke();
  [[14,58,"#ff5f57"],[20,58,"#febc2e"],[26,58,"#28c840"]].forEach(([tx,ty,tc])=>{
    ctx.fillStyle=tc as string; ctx.beginPath(); ctx.arc(tx as number,ty as number,2,0,Math.PI*2); ctx.fill();
  });
  ["> analyzing..","  found: 98%","> done ✓"].forEach((line,i)=>{
    ctx.globalAlpha=clamp01(t*.8-i*.6)*.9;
    ctx.fillStyle=i===2?"#22c55e":i===1?accent:"#9ca3af";
    ctx.font="5px monospace"; ctx.textAlign="left"; ctx.fillText(line,12,64+i*5);
  });
  if((t*2.5)%1>.45){ ctx.globalAlpha=1; ctx.fillStyle=accent; ctx.fillRect(48,70,4,3.5); }
  ctx.globalAlpha=1;
}

// ─── Code Rain ────────────────────────────────────────────────────────────────
function drawCodeRain(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const syms=["<",">","/","{","}","(",")",";","=","!"];
  for(let i=0;i<6;i++){
    const x=10+i*12+pulse(t,.5,i)*2, y=((t*10+i*8)%50)+2;
    ctx.globalAlpha=.15+.1*pulse(t,2,i); ctx.fillStyle=accent;
    ctx.font=`bold ${7+i%2}px monospace`; ctx.textAlign="center";
    ctx.fillText(syms[(i+Math.floor(t))%syms.length],x,y);
  }
  ctx.globalAlpha=1;
}

// ─── Sun Rays ─────────────────────────────────────────────────────────────────
function drawSunRays(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const sx=65,sy=14,sr=7;
  const g=ctx.createRadialGradient(sx,sy,0,sx,sy,20);
  g.addColorStop(0,`${accent}88`); g.addColorStop(.5,`${accent}30`); g.addColorStop(1,`${accent}00`);
  ctx.fillStyle=g; ctx.beginPath(); ctx.arc(sx,sy,22,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=accent; ctx.beginPath(); ctx.arc(sx,sy,sr,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.5)"; ctx.beginPath(); ctx.arc(sx-2,sy-2,sr*.5,0,Math.PI*2); ctx.fill();
  for(let i=0;i<8;i++){
    const ang=(Math.PI*2/8)*i+t*.3, r1=sr+3, r2=sr+7+pulse(t,2,i)*1.5;
    ctx.strokeStyle=accent; ctx.lineWidth=1.5; ctx.globalAlpha=.6+.3*pulse(t,1.5,i); ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(sx+Math.cos(ang)*r1,sy+Math.sin(ang)*r1);
    ctx.lineTo(sx+Math.cos(ang)*r2,sy+Math.sin(ang)*r2); ctx.stroke();
  }
  ctx.globalAlpha=1;
}

// ─── Hammock ──────────────────────────────────────────────────────────────────
function drawHammock(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const sw=pulse(t,.7)*3;
  ctx.strokeStyle=`${accent}88`; ctx.lineWidth=1.8; ctx.lineCap="round";
  ctx.beginPath(); ctx.moveTo(12,60+sw); ctx.bezierCurveTo(22,68+sw*.5,58,68+sw*.5,68,60-sw); ctx.stroke();
  ctx.lineWidth=1; ctx.strokeStyle=`${accent}60`;
  ctx.beginPath(); ctx.moveTo(12,60+sw); ctx.lineTo(8,50+sw*.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(68,60-sw); ctx.lineTo(72,50-sw*.5); ctx.stroke();
  for(let i=0;i<4;i++){
    const bx=20+i*14+pulse(t,.4,i)*4, by=((t*5+i*4)%40)+5;
    ctx.globalAlpha=clamp01(1-by/45)*.5; ctx.strokeStyle=accent; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.arc(bx,by,2+i%2,0,Math.PI*2); ctx.stroke();
  }
  ctx.globalAlpha=1;
}

// ─── Holographic Keyboard ─────────────────────────────────────────────────────
function drawHoloKeyboard(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  ctx.save(); ctx.translate(40,70); ctx.scale(1,.4);
  ctx.fillStyle=`${accent}15`; ctx.strokeStyle=`${accent}60`; ctx.lineWidth=.8;
  rr(ctx,-28,-8,56,16,3); ctx.fill(); ctx.stroke();
  // keys
  for(let r=0;r<2;r++) for(let c=0;c<7;c++){
    const kx=-24+c*7, ky=-5+r*7;
    const lit=(Math.floor(t*8+c+r*3))%14===c+r;
    ctx.fillStyle=lit?accent:`${accent}40`;
    ctx.globalAlpha=lit?.9:.4;
    rr(ctx,kx,ky,5.5,5.5,1); ctx.fill();
  }
  ctx.globalAlpha=1; ctx.restore();
}

// ─── Sparkles ─────────────────────────────────────────────────────────────────
function drawSparkles(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  for(let i=0;i<8;i++){
    const a=t*1.4+i*1.2, r=22+pulse(t,1.7,i)*5;
    const sx=40+Math.cos(a)*r, sy=40+Math.sin(a*.9)*r*.55;
    ctx.save(); ctx.translate(sx,sy); ctx.rotate(a);
    ctx.strokeStyle=i%2?"rgba(255,255,255,.72)":`${accent}bf`; ctx.lineWidth=1.3;
    ctx.beginPath(); ctx.moveTo(-3,0); ctx.lineTo(3,0); ctx.moveTo(0,-3); ctx.lineTo(0,3); ctx.stroke();
    ctx.restore();
  }
}

// ─── Speed Streaks ────────────────────────────────────────────────────────────
function drawStreaks(ctx: CanvasRenderingContext2D, t: number, accent: string, dir=-1) {
  ctx.lineCap="round";
  for(let i=0;i<5;i++){
    ctx.strokeStyle=`${accent}${(96-i*14).toString(16).padStart(2,"0")}`;
    ctx.lineWidth=1.5+(4-i)*.3;
    const y=22+i*9+pulse(t,4,i)*2.5, len=14-i*1.5;
    ctx.beginPath(); ctx.moveTo(40+dir*(26+i*2),y); ctx.lineTo(40+dir*(26+i*2+len),y+dir*.5); ctx.stroke();
  }
}

function drawDots(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  [0,1,2].forEach(i=>{
    const p=.35+.65*(.5+.5*pulse(t,5,i*1.2));
    ctx.globalAlpha=p; ctx.fillStyle=i===1?"#ffffff":accent;
    ctx.beginPath(); ctx.arc(29+i*8,66,2+p,0,Math.PI*2); ctx.fill();
  });
  ctx.globalAlpha=1;
}

// ══════════════════════════════════════════════════════════════════════════════
//  PIXEL ROBOT CHARACTER
// ══════════════════════════════════════════════════════════════════════════════

type PixelBotState =
  | "crabcrawl"
  | "explorer" | "hacker" | "artist" | "chef" | "rockstar"
  | "astronaut" | "gardener" | "superhero" | "party";

function pixelStateForMode(mode: AvatarMode): PixelBotState | null {
  if (
    mode === "crabcrawl" ||
    mode === "explorer" || mode === "hacker" || mode === "artist" || mode === "chef" ||
    mode === "rockstar" || mode === "astronaut" || mode === "gardener" ||
    mode === "superhero" || mode === "party"
  ) return mode;

  const aliases: Partial<Record<AvatarMode, PixelBotState>> = {
    idle: "crabcrawl",
    searching: "explorer",
    reading: "explorer",
    coding: "hacker",
    thinking: "hacker",
    monitoring: "hacker",
    writing: "artist",
    presenting: "artist",
    professor: "artist",
    exercising: "rockstar",
    dancing: "rockstar",
    listening: "rockstar",
    flying: "astronaut",
    swimming: "astronaut",
    gardener: "gardener",
    relaxing: "gardener",
    ninja: "superhero",
    cycling: "superhero",
    moonwalk: "superhero",
    celebrating: "party",
    sleeping: "party",
    dreaming: "party",
    meditate: "party",
    yoga: "party",
    assisting: "crabcrawl",
  };
  return aliases[mode] ?? null;
}

function ptxt(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, align: CanvasTextAlign = "center") {
  ctx.fillStyle = fill;
  ctx.font = `800 ${size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawHeroSpark(ctx: CanvasRenderingContext2D, x: number, y: number, c: string, s = 1) {
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.4 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 3 * s, y);
  ctx.lineTo(x + 3 * s, y);
  ctx.moveTo(x, y - 3 * s);
  ctx.lineTo(x, y + 3 * s);
  ctx.stroke();
}

function drawHeroShadow(ctx: CanvasRenderingContext2D, t: number, state: PixelBotState) {
  const lift = state === "superhero" || state === "astronaut" ? 5 : 0;
  const crawlX = state === "crabcrawl" ? pulse(t, 2.8) * 9 : 0;
  const squash = state === "crabcrawl" ? 24 + Math.abs(pulse(t, 8)) * 5 : state === "superhero" ? 18 : state === "astronaut" ? 14 : 20 + pulse(t, 2) * 1.2;
  const g = ctx.createRadialGradient(40 + crawlX, 69, 0, 40 + crawlX, 69, squash);
  g.addColorStop(0, "rgba(0,0,0,.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(40 + crawlX, 69 + lift, squash, state === "crabcrawl" ? 4 : 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawCape(ctx: CanvasRenderingContext2D, t: number, state: PixelBotState) {
  if (state !== "superhero" && state !== "astronaut") return;
  const wave = pulse(t, state === "superhero" ? 7 : 2.8) * (state === "superhero" ? 6 : 3);
  const trail = state === "superhero" ? 12 : state === "astronaut" ? 5 : 0;
  ctx.save();
  ctx.globalAlpha = state === "superhero" ? .88 : .44;
  const grad = ctx.createLinearGradient(18, 29, 78, 62);
  if (state === "superhero") {
    grad.addColorStop(0, "#fb7185");
    grad.addColorStop(.48, "#dc2626");
    grad.addColorStop(1, "#991b1b");
  } else {
    grad.addColorStop(0, "rgba(96,165,250,.14)");
    grad.addColorStop(.52, "rgba(56,189,248,.5)");
    grad.addColorStop(1, "rgba(96,165,250,0)");
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(26, 33);
  ctx.bezierCurveTo(45 + trail, 28 + wave, 60 + trail, 34 - wave, 73, 48 + wave * .35);
  ctx.bezierCurveTo(64 + trail * .4, 54 + wave, 50, 64 - wave * .2, 33, 54);
  ctx.bezierCurveTo(30, 48, 27, 40, 26, 33);
  ctx.fill();
  ctx.globalAlpha = state === "superhero" ? .6 : .3;
  ctx.strokeStyle = state === "superhero" ? "rgba(255,255,255,.7)" : "rgba(191,219,254,.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(32, 39);
  ctx.bezierCurveTo(45 + trail, 35 + wave, 57, 43, 68, 51 + wave * .25);
  ctx.stroke();
  ctx.restore();
}

function drawRobotLimb(ctx: CanvasRenderingContext2D, sx: number, sy: number, mx: number, my: number, ex: number, ey: number, width = 6) {
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(mx, my, ex, ey);
  ctx.stroke();
  ctx.strokeStyle = "rgba(67,56,202,.48)";
  ctx.lineWidth = 1.1;
  ctx.stroke();
  const joint = ctx.createRadialGradient(ex - 1, ey - 1, 1, ex, ey, 4.8);
  joint.addColorStop(0, "#ffffff");
  joint.addColorStop(.48, "#c7d2fe");
  joint.addColorStop(1, "#4c1d95");
  ctx.fillStyle = joint;
  ctx.beginPath();
  ctx.arc(ex, ey, 4.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeroRobot(ctx: CanvasRenderingContext2D, t: number, state: PixelBotState, accent: string) {
  const crawlPhase = t * 8;
  const crawlTravel = state === "crabcrawl" ? pulse(t, 2.8) * 9 : 0;
  const bob = state === "crabcrawl"
    ? 5 + Math.abs(pulse(t, 8)) * 2
    : state === "superhero" ? -8 + pulse(t, 5.4) * 2
    : state === "astronaut" ? -4 + pulse(t, 1.4) * 3
    : pulse(t, 2.2) * 1.5;
  const lean = state === "crabcrawl" ? pulse(t, 8) * .18 : state === "superhero" ? -.24 + pulse(t, 4) * .04 : state === "rockstar" ? pulse(t, 6) * .12 : state === "gardener" ? .09 : 0;
  const squash = state === "crabcrawl" ? 1.1 + Math.abs(pulse(t, 8)) * .08 : 1 + (state === "chef" ? pulse(t, 7) * .018 : pulse(t, 2.5) * .01);
  const cx = 40 + crawlTravel + (state === "superhero" ? pulse(t, 4) * 3 : 0);
  const cy = 38 + bob;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(lean);
  ctx.scale(squash, 1 / squash);

  const armPulse = pulse(t, state === "rockstar" ? 9 : state === "chef" ? 7 : 3);
  if (state === "crabcrawl") {
    drawRobotLimb(ctx,-13,7,-28,1 + pulse(crawlPhase,1) * 4,-35,9 + pulse(crawlPhase,1.2) * 3,6);
    drawRobotLimb(ctx,13,7,28,1 - pulse(crawlPhase,1) * 4,35,9 - pulse(crawlPhase,1.2) * 3,6);
    drawRobotLimb(ctx,-9,15,-25,20 + pulse(crawlPhase,1,Math.PI) * 3,-31,29,4.5);
    drawRobotLimb(ctx,9,15,25,20 - pulse(crawlPhase,1,Math.PI) * 3,31,29,4.5);
  } else if (state === "superhero") {
    drawRobotLimb(ctx,-13,5,-25,1,-30,-6,6);
    drawRobotLimb(ctx,13,5,23,1,30,-5,6);
  } else if (state === "rockstar") {
    drawRobotLimb(ctx,-13,8,-24,3,-28,-4 - armPulse * 2,6);
    drawRobotLimb(ctx,13,8,21,15,25,22,6);
  } else if (state === "chef") {
    drawRobotLimb(ctx,-13,8,-26,10,-31,18,6);
    drawRobotLimb(ctx,13,8,24,5,29,11 + armPulse * 3,6);
  } else if (state === "gardener") {
    drawRobotLimb(ctx,-13,8,-24,15,-28,23,6);
    drawRobotLimb(ctx,13,8,24,14,30,20 + armPulse,6);
  } else {
    drawRobotLimb(ctx,-13,8,-24,9 + armPulse * 2,-28,17 + armPulse * 2,6);
    drawRobotLimb(ctx,13,8,24,9 - armPulse * 2,28,17 - armPulse * 2,6);
  }

  // Body.
  const body = ctx.createRadialGradient(-6, 10, 2, 0, 20, 24);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(.58, "#f8fafc");
  body.addColorStop(1, "#c7d2fe");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 19, 13, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(67,56,202,.4)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = state === "explorer" || state === "gardener" ? "#60a5fa" : state === "party" ? "#f472b6" : state === "chef" ? "#ef4444" : "#3b82f6";
  rr(ctx,-12,27,24,5,2);
  ctx.fill();
  ctx.fillStyle = accent;
  rr(ctx,-6,16,12,7,2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.58)";
  rr(ctx,-4,17,8,3,1.5);
  ctx.fill();

  // Legs.
  if (state === "crabcrawl") {
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 2; i++) {
        const ph = crawlPhase + i * Math.PI + (side > 0 ? Math.PI * .5 : 0);
        drawRobotLimb(ctx,side * (4 + i * 5),30,side * (13 + i * 6),37 + pulse(ph,1) * 3,side * (20 + i * 6),45 + Math.abs(pulse(ph,1)) * 3,3.8);
      }
    });
  } else {
    drawRobotLimb(ctx,-6,32,-8,40,-13,47 + Math.max(0, pulse(t,4)) * 2,5);
    drawRobotLimb(ctx,6,32,9,39,12,47 + Math.max(0, pulse(t,4,Math.PI)) * 2,5);
  }

  // Side ear modules.
  [-1, 1].forEach((side) => {
    const gx = side * 18;
    const g = ctx.createRadialGradient(gx - side * 2, -14, 1, gx, -13, 8);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(.45, "#c7d2fe");
    g.addColorStop(1, "#312e81");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(gx, -13, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#4c1d95";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(gx, -13, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Head.
  const head = ctx.createRadialGradient(-8, -25, 3, 0, -14, 26);
  head.addColorStop(0, "#ffffff");
  head.addColorStop(.55, "#f8fafc");
  head.addColorStop(.82, "#dbeafe");
  head.addColorStop(1, "#a5b4fc");
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(0, -15, 21, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(67,56,202,.45)";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  const visor = ctx.createLinearGradient(-15, -25, 15, -8);
  visor.addColorStop(0, "#111827");
  visor.addColorStop(.5, "#24113f");
  visor.addColorStop(1, "#020617");
  ctx.fillStyle = visor;
  ctx.beginPath();
  ctx.ellipse(0, -17, 15.5, 10.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.18)";
  ctx.beginPath();
  ctx.ellipse(-5,-22,7,2.4,-.25,0,Math.PI*2);
  ctx.fill();

  const blink = (t * 2.4) % 6.5 > 6.1;
  if (state === "crabcrawl") {
    ctx.strokeStyle = "#bfdbfe";
    ctx.lineWidth = 1.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10,-17);
    ctx.quadraticCurveTo(-7,-14 + pulse(t,10)*.5,-4,-17);
    ctx.moveTo(4,-17);
    ctx.quadraticCurveTo(7,-14 - pulse(t,10)*.5,10,-17);
    ctx.stroke();
  } else if (state === "superhero" || state === "party") {
    ctx.fillStyle = "#93c5fd";
    ctx.beginPath();
    ctx.ellipse(-7,-17,3.2,1.7,.2,0,Math.PI*2);
    ctx.ellipse(7,-17,3.2,1.7,-.2,0,Math.PI*2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#bfdbfe";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10,-16);
    ctx.quadraticCurveTo(-7,-18 + (blink ? 2 : 0),-4,-16);
    ctx.moveTo(4,-16);
    ctx.quadraticCurveTo(7,-18 + (blink ? 2 : 0),10,-16);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,.2)";
  ctx.beginPath();
  ctx.ellipse(-7,-28,8,2.8,-.25,0,Math.PI*2);
  ctx.fill();

  ctx.restore();
}

function drawHeroActivity(ctx: CanvasRenderingContext2D, t: number, state: PixelBotState, accent: string) {
  switch (state) {
    case "crabcrawl": {
      const travel = pulse(t,2.8) * 9;
      const dir = pulse(t,2.8) > 0 ? 1 : -1;
      for (let i=0;i<5;i++) {
        const age = ((t*7+i*.23)%1);
        ctx.globalAlpha = (1-age) * .42;
        ctx.fillStyle = i%2 ? "#f97316" : accent;
        ctx.beginPath();
        ctx.ellipse(40 + travel - dir*(10+age*18+i*2), 68 - i%2, 2.8-age*1.5, 1.3, 0, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `${accent}aa`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(15, 63);
      ctx.bezierCurveTo(28, 58 + pulse(t,7)*2, 52, 58 - pulse(t,7)*2, 65, 63);
      ctx.stroke();
      ctx.setLineDash([]);
      ptxt(ctx,"{ }",40 + travel,18 + pulse(t,4)*1.5,9,"#f97316");
      break;
    }
    case "explorer":
      ctx.fillStyle = "#92400e"; rr(ctx,22,16,35,6,3); ctx.fill();
      ctx.fillStyle = "#b45309"; rr(ctx,27,11,25,9,4); ctx.fill();
      ctx.save(); ctx.translate(60,45 + pulse(t,2)*1.5); ctx.rotate(.18 + pulse(t,2.6)*.08);
      ctx.fillStyle = "#f5deb3"; rr(ctx,-8,-7,15,14,2); ctx.fill();
      ctx.strokeStyle = "#92400e"; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(-4,-3); ctx.lineTo(4,2); ctx.moveTo(1,-5); ctx.lineTo(-2,5); ctx.stroke();
      ctx.restore();
      break;
    case "hacker":
      ctx.fillStyle = "#111827"; rr(ctx,19,54,42,15,3); ctx.fill();
      ctx.fillStyle = "#334155"; rr(ctx,22,50,36,5,2); ctx.fill();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(40,59,3,0,Math.PI*2); ctx.fill();
      ptxt(ctx,"0101",63,24 + pulse(t,2)*1.5,6,accent);
      ptxt(ctx,"1010",62,32 + pulse(t,2.4)*1.5,6,"#86efac");
      break;
    case "artist":
      ctx.fillStyle = "#7e22ce"; rr(ctx,49,12,18,7,3); ctx.fill();
      ctx.strokeStyle = "#f97316"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(16,43); ctx.lineTo(24 + pulse(t,5)*3,36 + pulse(t,5)*2); ctx.stroke();
      ctx.fillStyle = "#fef3c7"; ctx.beginPath(); ctx.arc(16,43,3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = "#f5deb3"; rr(ctx,64,25,12,33,2); ctx.fill();
      ctx.fillStyle = "#fb7185"; ctx.beginPath(); ctx.moveTo(68,35); ctx.bezierCurveTo(70,29,76,32,72,39); ctx.fill();
      ctx.fillStyle = "#92400e"; ctx.beginPath(); ctx.ellipse(59,54,8,5,.15,0,Math.PI*2); ctx.fill();
      ["#22c55e","#ef4444","#38bdf8"].forEach((c,i)=>{ ctx.fillStyle=c; ctx.beginPath(); ctx.arc(57+i*5,52+i%2*3,2,0,Math.PI*2); ctx.fill(); });
      break;
    case "chef":
      ctx.fillStyle = "#ffffff"; rr(ctx,24,10,33,12,6); ctx.fill();
      [29,40,51].forEach((x,i)=>{ ctx.beginPath(); ctx.arc(x,10+i%2,6,0,Math.PI*2); ctx.fill(); });
      ctx.fillStyle = "#ef4444"; rr(ctx,25,43,5,16,2); ctx.fill();
      ctx.fillStyle = "#111827"; ctx.save(); ctx.translate(61,49); ctx.rotate(.15); rr(ctx,-12,-3,21,5,2); ctx.fill(); ctx.restore();
      ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.ellipse(62,37 + Math.abs(pulse(t,7))*-8,5,3,.3,0,Math.PI*2); ctx.fill();
      break;
    case "rockstar":
      ctx.fillStyle = "#ec4899"; [35,41,47].forEach((x,i)=>{ rr(ctx,x,6+i%2*3,5,15-i*2,2); ctx.fill(); });
      ctx.save(); ctx.translate(38,56); ctx.rotate(-.1 + pulse(t,8)*.04);
      ctx.fillStyle = "#dc2626"; rr(ctx,-15,-5,28,10,5); ctx.fill();
      ctx.fillStyle = "#92400e"; rr(ctx,10,-9,22,4,2); ctx.fill();
      ctx.strokeStyle = "#f8fafc"; ctx.lineWidth = .8; [-3,0,3].forEach((y)=>{ ctx.beginPath(); ctx.moveTo(-11,y); ctx.lineTo(30,y-6); ctx.stroke(); });
      ctx.restore();
      ptxt(ctx,"♪",17,24 + pulse(t,2)*3,13,"#a855f7"); ptxt(ctx,"♫",67,27 + pulse(t,2.5)*3,13,"#ec4899");
      break;
    case "astronaut":
      ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(16,50); ctx.bezierCurveTo(7,58,15,65,10,73); ctx.stroke();
      ctx.fillStyle = "#2563eb"; ctx.beginPath(); ctx.arc(67,55,6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = "#84cc16"; ctx.beginPath(); ctx.arc(69,52,2,0,Math.PI*2); ctx.arc(64,57,2,0,Math.PI*2); ctx.fill();
      drawHeroSpark(ctx,15,18,"#ffffff"); drawHeroSpark(ctx,68,20,accent); drawHeroSpark(ctx,61,13,"#ffffff");
      break;
    case "gardener":
      ctx.fillStyle = "#a16207"; rr(ctx,22,17,35,6,3); ctx.fill();
      ctx.fillStyle = "#ca8a04"; rr(ctx,27,11,25,9,4); ctx.fill();
      ctx.fillStyle = "#38bdf8"; ctx.save(); ctx.translate(22,54 + pulse(t,3)*1.5); ctx.rotate(-.45); rr(ctx,-8,-4,16,8,4); ctx.fill(); ctx.restore();
      ctx.fillStyle = "#a16207"; rr(ctx,61,57,9,10,2); ctx.fill();
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(65,57); ctx.quadraticCurveTo(64,50,65,45); ctx.stroke();
      ctx.fillStyle = "#84cc16"; ctx.beginPath(); ctx.ellipse(61,49,5,3,-.5,0,Math.PI*2); ctx.ellipse(69,46,5,3,.5,0,Math.PI*2); ctx.fill();
      for(let i=0;i<6;i++){ ctx.fillStyle="#7dd3fc"; ctx.beginPath(); ctx.arc(25+i*4,58+((t*12+i*5)%12),1.2,0,Math.PI*2); ctx.fill(); }
      break;
    case "superhero":
      drawStreaks(ctx,t,accent,-1);
      drawThrusterPuff(ctx,t,18,56,Math.PI,accent);
      drawStreaks(ctx,t,accent,-1);
      break;
    case "party":
      ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.moveTo(40,9); ctx.lineTo(52,20); ctx.lineTo(35,20); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fb7185"; rr(ctx,35,19,18,4,2); ctx.fill();
      ctx.fillStyle = "#cbd5e1"; ctx.beginPath(); ctx.arc(68,21,8,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 1; for(let i=0;i<4;i++){ ctx.beginPath(); ctx.moveTo(60+i*4,15); ctx.lineTo(60+i*2,29); ctx.stroke(); }
      for(let i=0;i<12;i++){
        const x=12+drand(i)*58, y=15+((t*18+i*9)%48);
        ctx.fillStyle = i%3===0?"#facc15":i%3===1?"#22d3ee":"#f472b6";
        ctx.fillRect(x,y,2.4,2.4);
      }
      break;
  }
}

function drawPixelScene(ctx: CanvasRenderingContext2D, state: PixelBotState, t: number, mode: AvatarMode) {
  const accent = MODE_META[mode].accent;
  glow(ctx,t,accent,40,43);
  drawSpaceDust(ctx,t,accent);
  drawHeroShadow(ctx,t,state);
  drawCape(ctx,t,state);
  drawHeroActivity(ctx,t,state,accent);
  drawHeroRobot(ctx,t,state,accent);
}

// ══════════════════════════════════════════════════════════════════════════════
//  NOVA CORE AVATAR
// ══════════════════════════════════════════════════════════════════════════════

type NovaMood = "calm" | "focus" | "joy" | "dash" | "sleep";

function drawNovaRing(ctx: CanvasRenderingContext2D, t: number, accent: string, mood: NovaMood) {
  const spin = t * (mood === "dash" ? 5.5 : 1.8);
  ctx.save();
  ctx.translate(40, 41);
  ctx.rotate(spin);
  ctx.strokeStyle = `${accent}aa`;
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.ellipse(0, 0, 30, 12 + pulse(t, 2) * 1.5, 0, .14 * Math.PI, 1.25 * Math.PI);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, 25, 9, 0, 1.34 * Math.PI, 1.78 * Math.PI);
  ctx.stroke();
  ctx.restore();
}

function drawNovaArm(ctx: CanvasRenderingContext2D, t: number, side: -1 | 1, mood: NovaMood, accent: string) {
  const wave = pulse(t, mood === "dash" ? 8 : 3.2, side > 0 ? .7 : 0);
  const lift = mood === "joy" ? -8 - Math.abs(wave) * 4 : mood === "focus" ? 3 + wave : mood === "dash" ? wave * 8 : wave * 3;
  const sx = 40 + side * 17;
  const sy = 42;
  const ex = 40 + side * (28 + Math.abs(wave) * 3);
  const ey = 48 + lift;
  ctx.strokeStyle = "rgba(226,232,240,.94)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(40 + side * 22, 43 + lift * .45, ex, ey);
  ctx.stroke();
  ctx.strokeStyle = `${accent}80`;
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const hand = ctx.createRadialGradient(ex - side * 1.5, ey - 1.5, 1, ex, ey, 5);
  hand.addColorStop(0, "#ffffff");
  hand.addColorStop(.52, "#cbd5e1");
  hand.addColorStop(1, "#334155");
  ctx.fillStyle = hand;
  ctx.beginPath();
  ctx.arc(ex, ey, 4.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawNovaCore(ctx: CanvasRenderingContext2D, t: number, mode: AvatarMode, accent: string, mood: NovaMood) {
  const bob = mood === "dash" ? pulse(t, 9) * 2 : pulse(t, 2.1) * 2.2;
  const squash = mood === "dash" ? 1 + Math.abs(pulse(t, 9)) * .08 : 1 + pulse(t, 2.4) * .018;
  const x = 40 + (mood === "dash" ? pulse(t, 5.4) * 7 : 0);
  const y = 40 + bob;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(squash, 1 / squash);

  drawNovaArm(ctx, t, -1, mood, accent);
  drawNovaArm(ctx, t, 1, mood, accent);

  const body = ctx.createRadialGradient(-8, -12, 3, 0, 0, 28);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(.45, "#dbeafe");
  body.addColorStop(.72, "#8b5cf6");
  body.addColorStop(1, "#111827");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 3, 19, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `${accent}99`;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const face = ctx.createLinearGradient(-13, -12, 13, 6);
  face.addColorStop(0, "#020617");
  face.addColorStop(.55, "#111827");
  face.addColorStop(1, "#0f172a");
  ctx.fillStyle = face;
  rr(ctx, -14, -11, 28, 17, 8);
  ctx.fill();

  const blink = (t * 2.6) % 7 > 6.55;
  ctx.strokeStyle = mood === "sleep" ? "#a78bfa" : "#67e8f9";
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (mood === "joy") {
    ctx.arc(-6, -4, 3, Math.PI * .08, Math.PI * .92);
    ctx.arc(6, -4, 3, Math.PI * .08, Math.PI * .92);
  } else if (mood === "focus" || mood === "dash") {
    ctx.moveTo(-9, -5); ctx.lineTo(-3, -4);
    ctx.moveTo(3, -4); ctx.lineTo(9, -5);
  } else if (mood === "sleep") {
    ctx.moveTo(-9, -4); ctx.lineTo(-3, -4);
    ctx.moveTo(3, -4); ctx.lineTo(9, -4);
  } else {
    ctx.moveTo(-8, -5);
    ctx.quadraticCurveTo(-6, -7 + (blink ? 2 : 0), -4, -5);
    ctx.moveTo(4, -5);
    ctx.quadraticCurveTo(6, -7 + (blink ? 2 : 0), 8, -5);
  }
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.globalAlpha = .95;
  rr(ctx, -7, 11, 14, 7, 3);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,.72)";
  rr(ctx, -4, 12, 8, 3, 1.5);
  ctx.fill();

  // Floating feet / stabilizers.
  [-1, 1].forEach((side) => {
    const fy = 27 + Math.abs(pulse(t, 4, side)) * 2;
    const foot = ctx.createLinearGradient(side * 3, fy - 3, side * 13, fy + 3);
    foot.addColorStop(0, "#e2e8f0");
    foot.addColorStop(1, "#334155");
    ctx.fillStyle = foot;
    ctx.beginPath();
    ctx.ellipse(side * 8, fy, 6, 3.2, side * .2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();

  for (let i = 0; i < 4; i++) {
    const a = t * 1.2 + i * Math.PI * .5;
    const r = 24 + pulse(t, 1.8, i) * 2;
    drawHeroSpark(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r * .72, i % 2 ? "#ffffff" : accent, .65);
  }
}

function novaMoodForMode(mode: AvatarMode): NovaMood {
  if (mode === "crabcrawl" || mode === "superhero" || mode === "ninja" || mode === "moonwalk") return "dash";
  if (mode === "hacker" || mode === "coding" || mode === "thinking" || mode === "monitoring") return "focus";
  if (mode === "party" || mode === "celebrating" || mode === "rockstar" || mode === "dancing") return "joy";
  if (mode === "sleeping" || mode === "dreaming" || mode === "meditate" || mode === "yoga") return "sleep";
  return "calm";
}

function drawNovaProp(ctx: CanvasRenderingContext2D, t: number, mode: AvatarMode, accent: string, mood: NovaMood) {
  const state = pixelStateForMode(mode) ?? "explorer";
  switch (state) {
    case "crabcrawl": {
      const travel = pulse(t, 5.4) * 7;
      for (let i = 0; i < 5; i++) {
        const age = (t * 7 + i * .18) % 1;
        ctx.globalAlpha = (1 - age) * .42;
        ctx.fillStyle = i % 2 ? "#f97316" : accent;
        ctx.beginPath();
        ctx.ellipse(40 + travel - 18 * age, 68 - i % 2, 3 - age * 1.4, 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `${accent}88`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(13, 62);
      ctx.bezierCurveTo(26, 56 + pulse(t, 8) * 2, 54, 56 - pulse(t, 8) * 2, 67, 62);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }
    case "hacker":
      ctx.save();
      ctx.translate(42, 59);
      ctx.rotate(pulse(t, 3) * .04);
      ctx.fillStyle = "#111827";
      rr(ctx, -21, -8, 42, 16, 3);
      ctx.fill();
      ctx.fillStyle = accent;
      ptxt(ctx, "101", -9, 0, 6, accent);
      ptxt(ctx, "010", 9, 0, 6, "#86efac");
      ctx.restore();
      break;
    case "artist":
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(16, 47);
      ctx.lineTo(23 + pulse(t, 5) * 4, 36 + pulse(t, 5) * 3);
      ctx.stroke();
      ctx.fillStyle = "#fef3c7";
      ctx.beginPath();
      ctx.arc(15, 48, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "chef":
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(31, 16, 6, 0, Math.PI * 2);
      ctx.arc(40, 13, 7, 0, Math.PI * 2);
      ctx.arc(49, 16, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.ellipse(62, 35 - Math.abs(pulse(t, 7)) * 9, 5, 3, .3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "rockstar":
      ptxt(ctx, "♪", 17, 23 + pulse(t, 2) * 3, 13, "#a855f7");
      ptxt(ctx, "♫", 66, 27 + pulse(t, 2.5) * 3, 13, "#ec4899");
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(25, 59);
      ctx.lineTo(54, 50 + pulse(t, 8) * 2);
      ctx.stroke();
      break;
    case "astronaut":
      drawHeroSpark(ctx, 15, 18, "#fff", .8);
      drawHeroSpark(ctx, 68, 20, accent, .9);
      ctx.fillStyle = "#2563eb";
      ctx.beginPath();
      ctx.arc(68, 55, 6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "gardener":
      ctx.fillStyle = "#a16207";
      rr(ctx, 61, 57, 9, 10, 2);
      ctx.fill();
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(65, 57);
      ctx.quadraticCurveTo(64, 50, 65, 45);
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = "#7dd3fc";
        ctx.beginPath();
        ctx.arc(23 + i * 4, 58 + ((t * 12 + i * 5) % 12), 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "superhero":
      drawStreaks(ctx, t, accent, -1);
      drawThrusterPuff(ctx, t, 18, 56, Math.PI, accent);
      break;
    case "party":
      for (let i = 0; i < 14; i++) {
        const x = 11 + drand(i) * 58;
        const y = 13 + ((t * 20 + i * 9) % 50);
        ctx.fillStyle = i % 3 === 0 ? "#facc15" : i % 3 === 1 ? "#22d3ee" : "#f472b6";
        ctx.fillRect(x, y, 2.5, 2.5);
      }
      break;
    default:
      if (mood === "sleep") drawZzz(ctx, t, accent);
  }
}

// ── Ninja mode: speed-slash arcs + afterimage trail ─────────────────────────
function drawNinjaOverlay(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  // Speed lines radiating outward
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + t * 6;
    const phase = ((t * 4 + i * 0.9) % 1);
    const r0 = 18 + phase * 22;
    const r1 = r0 + 8 + phase * 6;
    ctx.globalAlpha = (1 - phase) * 0.55;
    ctx.strokeStyle = i % 2 === 0 ? accent : "#ffffff";
    ctx.lineWidth = 1.2 - phase * 0.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(40 + Math.cos(ang) * r0, 40 + Math.sin(ang) * r0 * 0.7);
    ctx.lineTo(40 + Math.cos(ang) * r1, 40 + Math.sin(ang) * r1 * 0.7);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Slash arc — fast rotating slashes
  const slashT = (t * 3.5) % (Math.PI * 2);
  ctx.save();
  ctx.translate(40, 40);
  ctx.rotate(slashT);
  ctx.strokeStyle = `${accent}cc`;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.7 * Math.max(0, Math.sin(slashT * 2));
  ctx.beginPath();
  ctx.arc(0, 0, 26, -0.4, 0.9);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  // Ghost afterimage
  ctx.globalAlpha = 0.18 * (0.5 + 0.5 * Math.sin(t * 4));
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(40 + Math.sin(t * 5) * 8, 42, 10, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ── Coding mode: matrix rain columns + terminal glow ────────────────────────
function drawCodingOverlay(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  const chars = ["0", "1", "{", "}", "<", ">", "λ", "∑", "#", "≡"];
  for (let col = 0; col < 5; col++) {
    const x = 8 + col * 16;
    for (let row = 0; row < 4; row++) {
      const phase = ((t * (1.4 + col * 0.3) + row * 0.7 + col * 1.3) % 4) / 4;
      const y = phase * 70 + 5;
      ctx.globalAlpha = (1 - phase) * 0.65;
      ctx.fillStyle = row === 0 ? "#ffffff" : accent;
      ctx.font = `bold ${5 + (row === 0 ? 1 : 0)}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(chars[(col * 3 + row + Math.floor(t * 2)) % chars.length], x, y);
    }
  }
  ctx.globalAlpha = 1;
  // Terminal glow beneath bot
  const g = ctx.createRadialGradient(40, 65, 2, 40, 65, 22);
  g.addColorStop(0, `${accent}44`);
  g.addColorStop(1, `${accent}00`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(40, 65, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();
}

// ── Sleeping mode: slow breath scale + large ZZZ arcs ────────────────────────
function drawSleepingOverlay(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  // Breath scale glow (slow 4s cycle)
  const breath = (Math.sin(t * 1.6) + 1) / 2;
  const g = ctx.createRadialGradient(40, 44, 4, 40, 44, 28 + breath * 6);
  g.addColorStop(0, `${accent}38`);
  g.addColorStop(1, `${accent}00`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(40, 44, 28 + breath * 6, 22 + breath * 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // ZZZ rising in arcs
  [["z", 0, 0.9], ["Z", 0.35, 1.1], ["Z", 0.7, 1.3]].forEach(([ch, delay, scale], i) => {
    const age = ((t * 0.7 + Number(delay)) % 2.8) / 2.8;
    const x = 54 + Math.sin(age * Math.PI) * 8;
    const y = 30 - age * 28;
    ctx.globalAlpha = age < 0.15 ? age / 0.15 : age > 0.7 ? (1 - age) / 0.3 : 0.85;
    ctx.fillStyle = i === 2 ? "#ffffff" : accent;
    ctx.font = `900 ${Math.round(7 * Number(scale))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(ch as string, x, y);
  });
  ctx.globalAlpha = 1;

  // Moon
  ctx.save();
  ctx.translate(14, 14 + pulse(t, 0.8) * 1.5);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.arc(4, -2, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Dreaming mode: magic cloud float + orbiting stars ─────────────────────────
function drawDreamingOverlay(ctx: CanvasRenderingContext2D, t: number, accent: string) {
  // Soft dream cloud
  const cloudY = 18 + pulse(t, 0.7) * 3;
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = accent;
  [[-8, 0, 7], [0, -3, 9], [8, 0, 7], [-14, 3, 5], [14, 3, 5]].forEach(([dx, dy, r]) => {
    ctx.beginPath(); ctx.arc(20 + dx, cloudY + dy, r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Orbiting sparkle stars
  for (let i = 0; i < 5; i++) {
    const ang = t * 0.9 + (i / 5) * Math.PI * 2;
    const rx = 28, ry = 18;
    const sx = 40 + Math.cos(ang) * rx;
    const sy = 40 + Math.sin(ang) * ry;
    const tw = 0.5 + 0.5 * Math.sin(t * 2.5 + i);
    ctx.globalAlpha = tw * 0.85;
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : accent;
    ctx.font = `${i === 2 ? 9 : 6}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(i % 3 === 0 ? "✦" : "★", sx, sy);
  }
  ctx.globalAlpha = 1;

  // Dreamy ambient glow
  const dg = ctx.createRadialGradient(40, 40, 0, 40, 40, 38);
  dg.addColorStop(0, `${accent}22`);
  dg.addColorStop(1, `${accent}00`);
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(40, 40, 38, 0, Math.PI * 2); ctx.fill();
}

function drawNovaScene(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number) {
  const accent = MODE_META[mode].accent;
  const mood = novaMoodForMode(mode);
  glow(ctx, t, accent, 40, 42);

  // Mode-specific background overlays (drawn before bot)
  if (mode === "ninja")    drawNinjaOverlay(ctx, t, accent);
  if (mode === "coding")   drawCodingOverlay(ctx, t, accent);
  if (mode === "sleeping") drawSleepingOverlay(ctx, t, accent);
  if (mode === "dreaming") drawDreamingOverlay(ctx, t, accent);

  drawSpaceDust(ctx, t, accent);
  drawHeroShadow(ctx, t, mood === "dash" ? "crabcrawl" : "explorer");
  drawNovaRing(ctx, t, accent, mood);
  drawNovaProp(ctx, t, mode, accent, mood);
  drawNovaCore(ctx, t, mode, accent, mood);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ASTRONAUT CHARACTER
// ══════════════════════════════════════════════════════════════════════════════

type ArmPose = "idle"|"up"|"dance"|"point"|"swim"|"type"|"cross"|"mudra"|"wave"|"float"|"chill";
type VisorExpr = "happy"|"focus"|"sleep"|"alert"|"cool"|"star"|"hud"|"zen"|"scan";
type SuitStyle = "default"|"stealth"|"sage";

interface AstroOpts {
  x?: number; y?: number; scale?: number; tilt?: number; squash?: number;
  arm?: ArmPose; visor?: VisorExpr;
  helmetExtra?: "mortarboard"|"antenna"|"none";
  visorTint?: string;
  suit?: SuitStyle;
}

function drawAstronaut(ctx: CanvasRenderingContext2D, t: number, mode: AvatarMode, opts: AstroOpts = {}) {
  const accent = MODE_META[mode].accent;
  const x      = opts.x     ?? 40;
  const y      = opts.y     ?? 41;
  const sc     = opts.scale ?? 1;
  const tilt   = opts.tilt  ?? pulse(t,1.6)*.028;
  const sq     = opts.squash?? pulse(t,2.2)*.012;
  const arm    = opts.arm   ?? "idle";
  const visor  = opts.visor ?? "happy";
  const bob    = pulse(t,1.9)*1.6;  // zero-gravity float
  const suit   = opts.suit ?? "default";
  const palette = suit === "stealth"
    ? {
      pack0: "#273142", pack1: "#0f172a", arm: "#1f2937", armLight: "rgba(148,163,184,.36)",
      body0: "#364152", body1: "#1f2937", body2: "#0f172a", shell0: "#475569", shell1: "#1e293b", shell2: "#0f172a",
      boot0: "#1f2937", boot1: "#020617", ring0: "#020617", ring1: "#334155",
    }
    : suit === "sage"
      ? {
        pack0: "#ddd6fe", pack1: "#a78bfa", arm: "#ddd6fe", armLight: "rgba(255,255,255,.62)",
        body0: "#f5f3ff", body1: "#ddd6fe", body2: "#c4b5fd", shell0: "#faf5ff", shell1: "#ddd6fe", shell2: "#a78bfa",
        boot0: "#c4b5fd", boot1: "#7c3aed", ring0: "#a78bfa", ring1: "#ede9fe",
      }
      : {
        pack0: "#dde3e8", pack1: "#9ba5af", arm: "#d4dae0", armLight: "rgba(255,255,255,.55)",
        body0: "#f0f4f8", body1: "#dde3ea", body2: "#b0bec5", shell0: "#f0f4f8", shell1: "#dde3ea", shell2: "#9baab5",
        boot0: "#b0bec5", boot1: "#607080", ring0: "#9baab5", ring1: "#c5d0d8",
      };

  ctx.save();
  ctx.translate(x, y + bob);
  ctx.rotate(tilt);
  ctx.scale(sc*(1+sq), sc*(1-sq*1.2));

  // ── PLSS backpack (drawn first so body covers edges) ─────────────────────
  const bp = ctx.createLinearGradient(-12,0,-4,18);
  bp.addColorStop(0,palette.pack0); bp.addColorStop(1,palette.pack1);
  ctx.fillStyle=bp; rr(ctx,-12,0,9,16,2); ctx.fill();
  ctx.strokeStyle="rgba(0,0,0,.18)"; ctx.lineWidth=.7; rr(ctx,-12,0,9,16,2); ctx.stroke();
  // backpack detail lines
  ctx.strokeStyle="rgba(255,255,255,.35)"; ctx.lineWidth=.6;
  ctx.beginPath(); ctx.moveTo(-11,4); ctx.lineTo(-4,4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-11,8); ctx.lineTo(-4,8); ctx.stroke();

  // ── ARMS ─────────────────────────────────────────────────────────────────
  // Calculate arm positions
  let lArmAng = 0, rArmAng = 0, lArmExt = 0, rArmExt = 0;
  if (arm==="up")    { lArmAng=-1.1-pulse(t,4)*.15; rArmAng=-1.1-pulse(t,4,.5)*.15; }
  else if(arm==="dance"){ lArmAng=-.4+pulse(t,5.5)*.8; rArmAng=-.4-pulse(t,5.5,.8)*.8; }
  else if(arm==="point"){ lArmAng=.3+pulse(t,2)*.05; rArmAng=-.7+pulse(t,2,.5)*.05; }
  else if(arm==="swim") { lArmAng=pulse(t,4)*.9; rArmAng=-pulse(t,4,Math.PI)*.9; }
  else if(arm==="type") { lArmAng=.55+pulse(t,8)*.12; rArmAng=.55+pulse(t,8,.7)*.12; }
  else if(arm==="cross"){ lArmAng=.2; rArmAng=.2; lArmExt=-.3; rArmExt=.3; }
  else if(arm==="mudra"){ lArmAng=.85; rArmAng=.85; }
  else if(arm==="wave") { lArmAng=.2+pulse(t,2)*.08; rArmAng=-1.0-Math.abs(pulse(t,5))*.3; }
  else if(arm==="float"){ lArmAng=.4+pulse(t,1.3)*.2; rArmAng=.4+pulse(t,1.3,.8)*.2; }
  else if(arm==="chill"){ lArmAng=.6; rArmAng=.6; }
  else { lArmAng=.25+pulse(t,2.2)*.12; rArmAng=.25+pulse(t,2.2,.9)*.12; }

  // Draw arm tubes
  const drawArmTube=(side:number, ang:number, ext:number)=>{
    const ax=side*13, ay=6;
    const ex=ax+Math.sin(-ang*side+ext)*18*side, ey=ay+Math.cos(-ang+Math.abs(ext))*18;
    // upper tube
    ctx.strokeStyle=palette.arm; ctx.lineWidth=6; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo(ax+side*4,ay+6,ex,ey); ctx.stroke();
    // highlight stripe
    ctx.strokeStyle=palette.armLight; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo(ax+side*3,ay+5,ex-side*.5,ey-.5); ctx.stroke();
    // glove (hand)
    ctx.fillStyle="#2d3748"; ctx.beginPath(); ctx.ellipse(ex,ey,4.5,3.5,(-ang+Math.abs(ext))*.3,0,Math.PI*2); ctx.fill();
    // glove ring connector
    ctx.strokeStyle="rgba(255,255,255,.4)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.ellipse(ex,ey,5,4,(-ang+Math.abs(ext))*.3,0,Math.PI*2); ctx.stroke();
  };
  drawArmTube(-1, lArmAng, lArmExt);
  drawArmTube( 1, rArmAng, rArmExt);

  // ── BODY (suit torso) ────────────────────────────────────────────────────
  const bodyGrad = ctx.createLinearGradient(-14,-4,14,24);
  bodyGrad.addColorStop(0,palette.body0); bodyGrad.addColorStop(.5,palette.body1);
  bodyGrad.addColorStop(1,palette.body2);
  ctx.fillStyle=bodyGrad;
  rr(ctx,-14,-4,28,28,9); ctx.fill();
  ctx.strokeStyle="rgba(180,192,200,.8)"; ctx.lineWidth=1; rr(ctx,-14,-4,28,28,9); ctx.stroke();

  // Body highlight
  ctx.fillStyle="rgba(255,255,255,.45)";
  rr(ctx,-11,-3,12,10,4); ctx.fill();

  // Suit stripe (accent colour on left shoulder)
  ctx.fillStyle=accent; rr(ctx,-14,4,4,10,2); ctx.fill();
  ctx.fillStyle=`${accent}88`; rr(ctx,-14,16,4,4,2); ctx.fill();

  // Chest connector / life support port
  ctx.fillStyle="#4a5568"; ctx.beginPath(); ctx.arc(3,6,3.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="#1a202c"; ctx.beginPath(); ctx.arc(3,6,2,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=`${accent}cc`; ctx.beginPath(); ctx.arc(3,6,.8,0,Math.PI*2); ctx.fill();

  // Flag patch on right chest
  const flagX=6, flagY=12;
  ctx.fillStyle="#dc2626"; ctx.fillRect(flagX,flagY,6,4);
  ctx.fillStyle="#ffffff"; ctx.fillRect(flagX,flagY+1.3,6,1.3);
  ctx.fillStyle="#1d4ed8"; ctx.fillRect(flagX,flagY,3,4);

  // Oxygen connector tube (helmet to body)
  ctx.strokeStyle="#718096"; ctx.lineWidth=1.5;
  ctx.beginPath(); ctx.moveTo(-4,-6); ctx.quadraticCurveTo(-8,-2,-9,2); ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.3)"; ctx.lineWidth=.6;
  ctx.beginPath(); ctx.moveTo(-4,-6); ctx.quadraticCurveTo(-8,-2,-9,2); ctx.stroke();

  // Boot stubs
  [-8,4].forEach(bx=>{
    const bootG=ctx.createLinearGradient(bx,22,bx,30);
    bootG.addColorStop(0,palette.boot0); bootG.addColorStop(1,palette.boot1);
    ctx.fillStyle=bootG; rr(ctx,bx,22,8,9,3); ctx.fill();
    ctx.strokeStyle="rgba(0,0,0,.2)"; ctx.lineWidth=.7; rr(ctx,bx,22,8,9,3); ctx.stroke();
  });

  // ── HELMET ───────────────────────────────────────────────────────────────
  const hcx=0, hcy=-16, hr=14.5;

  // Helmet outer shell
  const hGrad=ctx.createRadialGradient(-3,-20,2,-3,-20,hr*1.2);
  hGrad.addColorStop(0,palette.shell0); hGrad.addColorStop(.7,palette.shell1); hGrad.addColorStop(1,palette.shell2);
  ctx.fillStyle=hGrad; ctx.beginPath(); ctx.arc(hcx,hcy,hr,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle="rgba(100,130,150,.5)"; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(hcx,hcy,hr,0,Math.PI*2); ctx.stroke();

  // Helmet neck ring
  const ringG=ctx.createLinearGradient(-hr,-4,hr,-1);
  ringG.addColorStop(0,palette.ring0); ringG.addColorStop(.5,palette.ring1); ringG.addColorStop(1,palette.ring0);
  ctx.fillStyle=ringG; rr(ctx,-hr+2,-5,hr*2-4,5,2); ctx.fill();

  // ── VISOR ────────────────────────────────────────────────────────────────
  const vx=hcx, vy=hcy-1, vrx=9, vry=7.5;
  const vTint=opts.visorTint??"#d97706";  // amber gold default

  // Visor glass fill
  const visGrad=ctx.createLinearGradient(vx-vrx,vy-vry,vx+vrx,vy+vry);
  visGrad.addColorStop(0,`${vTint}ff`); visGrad.addColorStop(.5,`${vTint}dd`); visGrad.addColorStop(1,`${vTint}99`);
  ctx.fillStyle=visGrad; ctx.beginPath(); ctx.ellipse(vx,vy,vrx,vry,0,0,Math.PI*2); ctx.fill();

  // Visor inner depth ring
  ctx.strokeStyle=`${vTint}66`; ctx.lineWidth=1;
  ctx.beginPath(); ctx.ellipse(vx,vy,vrx-1.5,vry-1.5,0,0,Math.PI*2); ctx.stroke();

  // ── FACE / EXPRESSION inside visor ──────────────────────────────────────
  ctx.save();
  ctx.beginPath(); ctx.ellipse(vx,vy,vrx-1,vry-1,0,0,Math.PI*2); ctx.clip();

  if(visor==="happy"){
    // Two happy arc eyes
    ctx.strokeStyle="#1a0a00"; ctx.lineWidth=1.5;
    [-3.5,3.5].forEach(ex=>{
      ctx.beginPath(); ctx.arc(ex,vy-1,2,Math.PI*.15,Math.PI*.85); ctx.stroke();
    });
    // smile
    ctx.beginPath(); ctx.arc(vx,vy+1.5,3,Math.PI*.1,Math.PI*.9); ctx.stroke();
    // cheek dots
    ctx.fillStyle="#b45309"; ctx.globalAlpha=.5;
    ctx.beginPath(); ctx.arc(-4.5,vy+1.5,1.2,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5,vy+1.5,1.2,0,Math.PI*2); ctx.fill();
    ctx.globalAlpha=1;
  } else if(visor==="focus"){
    // Narrowed rectangular eyes with glow
    [-3.5,3.5].forEach(ex=>{
      ctx.fillStyle="#0d0800"; rr(ctx,ex-2.2,vy-2.5,4.4,3,1); ctx.fill();
      ctx.fillStyle="#fef08a"; ctx.globalAlpha=.9; rr(ctx,ex-1.8,vy-2,3.6,2,1); ctx.fill();
      ctx.globalAlpha=1;
    });
  } else if(visor==="sleep"){
    ctx.strokeStyle="#1a0a00"; ctx.lineWidth=1.5;
    [-3.5,3.5].forEach(ex=>{ ctx.beginPath(); ctx.moveTo(ex-2,vy); ctx.lineTo(ex+2,vy); ctx.stroke(); });
    ctx.strokeStyle="#9a3412"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(vx,vy+2,2.5,Math.PI*.1,Math.PI*.9); ctx.stroke();
  } else if(visor==="alert"){
    [-3.5,3.5].forEach(ex=>{
      ctx.fillStyle="#7f1d1d"; ctx.beginPath(); ctx.arc(ex,vy-1,2.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle="#fca5a5"; ctx.beginPath(); ctx.arc(ex,vy-1,1.5,0,Math.PI*2); ctx.fill();
    });
    ctx.fillStyle="#7f1d1d"; ctx.beginPath(); ctx.arc(vx,vy+1.5,1,0,Math.PI*2); ctx.fill();
  } else if(visor==="cool"){
    // Shades bar across visor
    ctx.fillStyle="rgba(0,0,30,.75)"; rr(ctx,vx-7,vy-3,14,4,2); ctx.fill();
    ctx.fillStyle="rgba(255,255,255,.15)"; rr(ctx,vx-6.5,vy-2.8,5.5,1.5,1); ctx.fill();
    ctx.strokeStyle="#1a0a00"; ctx.lineWidth=1.2; rr(ctx,vx-7,vy-3,14,4,2); ctx.stroke();
    ctx.strokeStyle="#1a0a00"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(vx,vy+1.5,2.5,Math.PI*.1,Math.PI*.9); ctx.stroke();
  } else if(visor==="star"){
    [-3.5,3.5].forEach(ex=>{
      ctx.fillStyle="#fef08a"; ctx.font="bold 8px sans-serif"; ctx.textAlign="center";
      ctx.textBaseline="middle"; ctx.fillText("★",ex,vy-1);
    });
  } else if(visor==="hud"){
    // HUD lines
    ctx.strokeStyle="rgba(0,255,180,.7)"; ctx.lineWidth=.7;
    for(let i=0;i<3;i++){
      ctx.beginPath(); ctx.moveTo(vx-7,vy-3+i*3); ctx.lineTo(vx+7,vy-3+i*3); ctx.stroke();
    }
    ctx.strokeStyle="rgba(0,255,180,.9)"; ctx.beginPath(); ctx.arc(vx,vy,3,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle="rgba(0,255,180,.9)"; ctx.beginPath(); ctx.arc(vx,vy,1,0,Math.PI*2); ctx.fill();
  } else if(visor==="zen"){
    ctx.strokeStyle="#1a0a00"; ctx.lineWidth=1.2;
    [-3.5,3.5].forEach(ex=>{ ctx.beginPath(); ctx.arc(ex,vy-.5,2,Math.PI*0,Math.PI); ctx.stroke(); });
    ctx.strokeStyle="#9a3412"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(vx,vy+1.5,2,Math.PI*.2,Math.PI*.8); ctx.stroke();
  } else if(visor==="scan"){
    const scanY=vy-4+((t*3.5)%8);
    ctx.strokeStyle="rgba(255,120,0,.9)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(vx-7,scanY); ctx.lineTo(vx+7,scanY); ctx.stroke();
    ctx.fillStyle="rgba(255,120,0,.25)";
    ctx.fillRect(vx-7,scanY-1,14,3);
  }

  ctx.restore();

  // Visor glare highlight (white arc, top-left)
  ctx.fillStyle="rgba(255,255,255,.55)";
  ctx.beginPath(); ctx.ellipse(vx-4,vy-3.5,3.5,2,-.5,0,Math.PI*2); ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.3)";
  ctx.beginPath(); ctx.ellipse(vx+3,vy-2.5,1.5,1,-.3,0,Math.PI*2); ctx.fill();

  // Visor outer rim
  ctx.strokeStyle="rgba(120,90,20,.6)"; ctx.lineWidth=1.2;
  ctx.beginPath(); ctx.ellipse(vx,vy,vrx,vry,0,0,Math.PI*2); ctx.stroke();

  // Helmet top highlight
  ctx.fillStyle="rgba(255,255,255,.38)";
  ctx.beginPath(); ctx.ellipse(-4,-26,5,3.5,-.3,0,Math.PI*2); ctx.fill();

  // ── HELMET EXTRA ACCESSORY ───────────────────────────────────────────────
  if(opts.helmetExtra==="mortarboard"){
    // Board sitting on top of helmet
    const fl2=pulse(t,1.5)*.6;
    ctx.save(); ctx.translate(0,-29+fl2);
    ctx.fillStyle="#1e293b"; rr(ctx,-14,-3,28,4,1); ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.2)"; ctx.lineWidth=.7; rr(ctx,-14,-3,28,4,1); ctx.stroke();
    ctx.fillStyle="#1e293b"; ctx.beginPath();
    ctx.moveTo(-9,0); ctx.lineTo(0,-9); ctx.lineTo(9,0); ctx.closePath(); ctx.fill();
    // tassel
    ctx.strokeStyle=accent; ctx.lineWidth=1;
    const tlen=4+pulse(t,3)*2;
    ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(6+tlen,tlen*.7); ctx.stroke();
    ctx.fillStyle=accent; ctx.beginPath(); ctx.arc(6+tlen,tlen*.7,1.8,0,Math.PI*2); ctx.fill();
    ctx.restore();
  } else if(opts.helmetExtra==="antenna"){
    // Signal antenna on helmet
    const ant=pulse(t,4)*.6;
    ctx.strokeStyle="#94a3b8"; ctx.lineWidth=1.5; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(11,-28); ctx.lineTo(11+ant,-36); ctx.stroke();
    const sigR=2+pulse(t,3)*.8;
    ctx.globalAlpha=.6+.4*pulse(t,3); ctx.strokeStyle=accent; ctx.lineWidth=.8;
    ctx.beginPath(); ctx.arc(11+ant,-36,sigR,0,Math.PI*2); ctx.stroke();
    ctx.globalAlpha=1; ctx.fillStyle=accent; ctx.beginPath(); ctx.arc(11+ant,-36,1.2,0,Math.PI*2); ctx.fill();
  }

  ctx.restore();
}

// ══════════════════════════════════════════════════════════════════════════════
//  ORANGE ROBOT CHARACTER (Chibi Style)
// ══════════════════════════════════════════════════════════════════════════════

// Orange Robot eye types
type OrangeEyeType = "normal" | "star" | "teardrop" | "heart" | "single" | "x";

// Orange Robot activity types  
type OrangeActivity = "idle" | "happy" | "excited" | "sad" | "thinking" | "waving" | "balloon" | "garden" | "weight";

function getOrangeActivity(mode: AvatarMode): OrangeActivity {
  if (mode === "orangerobot") return "idle";
  if (mode === "party" || mode === "celebrating" || mode === "dancing") return "excited";
  if (mode === "sleeping" || mode === "dreaming" || mode === "meditate") return "sad";
  if (mode === "thinking" || mode === "hacker" || mode === "coding") return "thinking";
  if (mode === "gardener" || mode === "chef") return "garden";
  if (mode === "exercising" || mode === "cycling") return "weight";
  return "happy";
}

function getOrangeEyeType(mode: AvatarMode, t: number): OrangeEyeType {
  const activity = getOrangeActivity(mode);
  if (activity === "excited") return ((t * 2) % 4) > 2 ? "star" : "normal";
  if (activity === "sad") return "teardrop";
  if (activity === "thinking") return ((t * 2) % 4) > 2 ? "single" : "normal";
  if (activity === "waving") return "normal";
  return "normal";
}

// Draw the Orange Robot's head with mohawk
function drawOrangeHead(ctx: CanvasRenderingContext2D, t: number, eyeType: OrangeEyeType, accent: string = "#ff6b00") {
  const cx = 40;
  const cy = 35;
  const bob = pulse(t, 2) * 2;
  
  ctx.save();
  ctx.translate(cx, cy + bob);
  
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(0, 8, 22, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Main head (squashed hexagon/trapezoid shape)
  ctx.fillStyle = accent;
  ctx.beginPath();
  // Using rounded rectangle with slight taper
  ctx.moveTo(-18, -12);
  ctx.lineTo(-22, -4);
  ctx.lineTo(-20, 8);
  ctx.lineTo(-8, 16);
  ctx.lineTo(8, 16);
  ctx.lineTo(20, 8);
  ctx.lineTo(22, -4);
  ctx.lineTo(18, -12);
  ctx.closePath();
  ctx.fill();
  
  // Subtle highlight on head
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.ellipse(-5, -8, 10, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Mohawk fin on top
  ctx.fillStyle = "#e55a00";
  ctx.beginPath();
  ctx.moveTo(-8, -14);
  ctx.lineTo(0, -22);
  ctx.lineTo(8, -14);
  ctx.closePath();
  ctx.fill();
  
  ctx.strokeStyle = "#d14a00";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-8, -14);
  ctx.lineTo(0, -22);
  ctx.lineTo(8, -14);
  ctx.stroke();
  
  // Faceplate (dark charcoal/grey rounded rectangle)
  ctx.fillStyle = "#2d2d2d";
  rr(ctx, -12, -2, 24, 14, 4);
  ctx.fill();
  
  // Faceplate highlight
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  rr(ctx, -10, 0, 20, 5, 2);
  ctx.fill();
  
  // Draw eyes based on type
  drawOrangeEyes(ctx, eyeType, accent);
  
  ctx.restore();
}

// Draw the Orange Robot's eyes
function drawOrangeEyes(ctx: CanvasRenderingContext2D, eyeType: OrangeEyeType, accent: string = "#ff6b00") {
  const blink = ((Date.now() / 1000) * 3) % 5 > 4.5;
  
  switch (eyeType) {
    case "star":
      // Star-shaped eyes
      ctx.fillStyle = "#ffffff";
      drawStar(ctx, -7, -2, 5, 4, 5);
      drawStar(ctx, 7, -2, 5, 4, 5);
      break;
    case "teardrop":
      // Teardrop eyes (sad)
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-7, -2, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(7, -2, 4, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Tear dots
      ctx.fillStyle = "#a0d8f0";
      ctx.beginPath();
      ctx.arc(-7, 4, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, 4, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "heart":
      // Heart eyes
      ctx.fillStyle = "#ff99cc";
      drawHeart(ctx, -7, -2, 4);
      drawHeart(ctx, 7, -2, 4);
      break;
    case "single":
      // Single eye (thinking - one eye closed)
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(0, -2, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Eyebrow
      ctx.strokeStyle = "#2d2d2d";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-8, -7);
      ctx.lineTo(8, -7);
      ctx.stroke();
      break;
    case "x":
      // X eyes (sleeping/error)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-9, -4);
      ctx.lineTo(-5, 0);
      ctx.moveTo(-5, -4);
      ctx.lineTo(-9, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 0);
      ctx.lineTo(9, -4);
      ctx.moveTo(9, 0);
      ctx.lineTo(5, -4);
      ctx.stroke();
      break;
    default:
      // Normal circular eyes
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(-7, -2, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(7, -2, 5, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Small white highlight for depth
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(-5, -3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(9, -3, 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Pupils/iris (slightly off-center)
      ctx.fillStyle = "#2d2d2d";
      ctx.beginPath();
      ctx.arc(-7, -2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(7, -2, 2, 0, Math.PI * 2);
      ctx.fill();
  }
}

// Draw a star shape
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, outerRadius: number, innerRadius: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fill();
}

// Draw a heart shape
function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - size * 1.3);
  ctx.bezierCurveTo(x - size, y - size * 1.3, x - size * 1.5, y - size * 0.5, x, y + size * 0.5);
  ctx.bezierCurveTo(x + size * 1.5, y - size * 0.5, x + size, y - size * 1.3, x, y - size * 1.3);
  ctx.closePath();
  ctx.fill();
}

// Draw the Orange Robot's body
function drawOrangeBody(ctx: CanvasRenderingContext2D, t: number, accent: string = "#ff6b00") {
  const cx = 40;
  const cy = 55;
  const bob = pulse(t, 1.8) * 1.5;
  
  ctx.save();
  ctx.translate(cx, cy + bob);
  
  // Body (small rounded rectangle)
  ctx.fillStyle = accent;
  rr(ctx, -12, -6, 24, 16, 4);
  ctx.fill();
  
  // Body shadow
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  rr(ctx, -12, 10, 24, 4, 2);
  ctx.fill();
  
  // Body highlight
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  rr(ctx, -8, -4, 16, 4, 2);
  ctx.fill();
  
  // Limbs - floating nubs
  const armWave = pulse(t, 2) * 3;
  const legWave = pulse(t, 1.5) * 2;
  
  // Left arm
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(-20, -8 + armWave, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Right arm
  ctx.beginPath();
  ctx.ellipse(20, -8 - armWave, 8, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Left leg
  ctx.beginPath();
  ctx.ellipse(-14, 14 + legWave, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Right leg
  ctx.beginPath();
  ctx.ellipse(14, 14 - legWave, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Limb shadows
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(-20, 10, 8, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(20, 10, 8, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

// Draw Orange Robot activity items
function drawOrangeActivity(ctx: CanvasRenderingContext2D, t: number, activity: OrangeActivity, accent: string) {
  switch (activity) {
    case "excited":
      // Sparkles around robot
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + t * 2;
        const distance = 30 + pulse(t, 3, i) * 5;
        const sx = 40 + Math.cos(angle) * distance;
        const sy = 40 + Math.sin(angle) * distance * 0.7;
        drawStar(ctx, sx, sy, 3 + pulse(t, 4, i), 1.5, 5);
      }
      break;
    case "happy":
      // Small smile on faceplate
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(40, 38, 8, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      break;
    case "sad":
      // Nothing extra - teardrop eyes already show sadness
      break;
    case "thinking":
      // Thought bubble
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(55, 20, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(48, 20, 4, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(58, 24, 3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "waving":
      // Waving hand - arm is already waving
      break;
    case "balloon":
      // Balloon
      ctx.fillStyle = "#ffeb3b";
      ctx.strokeStyle = "#ffc107";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(60, 15, 8, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(60, 25);
      ctx.lineTo(50, 35);
      ctx.stroke();
      break;
    case "garden":
      // Small plant
      ctx.fillStyle = "#4caf50";
      ctx.beginPath();
      ctx.moveTo(60, 55);
      ctx.lineTo(60, 45);
      ctx.lineTo(55, 50);
      ctx.lineTo(60, 45);
      ctx.lineTo(65, 50);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8bc34a";
      ctx.beginPath();
      ctx.arc(55, 50, 3, 0, Math.PI * 2);
      ctx.arc(65, 50, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "weight":
      // Weight/dumbbell
      ctx.fillStyle = "#757575";
      ctx.beginPath();
      ctx.ellipse(60, 50, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(50, 50, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#b0bec5";
      rr(ctx, 45, 48, 10, 6, 1);
      ctx.fill();
      break;
  }
}

// Draw the complete Orange Robot scene
function drawOrangeScene(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number) {
  const accent = MODE_META[mode].accent;
  const activity = getOrangeActivity(mode);
  const eyeType = getOrangeEyeType(mode, t);
  
  // Background glow
  glow(ctx, t, accent, 40, 42);
  
  // Draw body first (behind head)
  drawOrangeBody(ctx, t, accent);
  
  // Draw head with face
  drawOrangeHead(ctx, t, eyeType, accent);
  
  // Draw activity items
  drawOrangeActivity(ctx, t, activity, accent);
  
  // Floating particles for charm
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + t * 0.5;
    const distance = 25 + pulse(t, 2, i) * 3;
    const sx = 40 + Math.cos(angle) * distance;
    const sy = 40 + Math.sin(angle) * distance * 0.6;
    ctx.globalAlpha = 0.4 + pulse(t, 3, i) * 0.2;
    ctx.fillStyle = i % 2 === 0 ? accent : "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  THE SENTINEL — Enterprise AI Shield Character
// ══════════════════════════════════════════════════════════════════════════════

type SentinelState = "idle" | "scan" | "code" | "sleep" | "dream" | "threat" | "celebrate" | "assist";

function sentinelStateForMode(mode: AvatarMode): SentinelState {
  switch (mode) {
    case "sentinel":                                         return "idle";
    case "thinking": case "monitoring": case "searching":
    case "reading": case "professor":                        return "scan";
    case "coding": case "hacker": case "writing":            return "code";
    case "sleeping": case "meditate": case "yoga":           return "sleep";
    case "dreaming": case "relaxing":                        return "dream";
    case "ninja": case "crabcrawl": case "flying":
    case "skating": case "moonwalk":                         return "threat";
    case "celebrating": case "party": case "dancing":
    case "rockstar": case "superhero":                       return "celebrate";
    default:                                                 return "assist";
  }
}

function drawSentinelBody(ctx: CanvasRenderingContext2D, t: number, state: SentinelState) {
  const bob    = Math.sin(t * 1.8) * 2;
  const squash = Math.sin(t * 1.8) * 0.013;

  const glowCol = state === "scan"      ? "#00d4ff"
    : state === "code"      ? "#4ade80"
    : state === "sleep"     ? "#818cf8"
    : state === "dream"     ? "#a78bfa"
    : state === "threat"    ? "#ef4444"
    : state === "celebrate" ? "#facc15"
    :                         "#ff6b00";

  ctx.save();
  ctx.translate(40, 42 + bob);
  ctx.scale(1 + squash, 1 - squash);

  // Ambient body glow
  const dimMult = state === "sleep" ? 0.14 : 0.26 + Math.sin(t * 2.4) * 0.08;
  const ag = ctx.createRadialGradient(0, 2, 8, 0, 8, 42);
  ag.addColorStop(0, `${glowCol}${Math.round(dimMult * 255).toString(16).padStart(2,"0")}`);
  ag.addColorStop(1, `${glowCol}00`);
  ctx.fillStyle = ag;
  ctx.beginPath(); ctx.ellipse(0, 6, 40, 38, 0, 0, Math.PI * 2); ctx.fill();

  // Drop shadow
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath(); ctx.ellipse(2, 30, 19, 5.5, 0, 0, Math.PI * 2); ctx.fill();

  // Shield body
  const bg = ctx.createLinearGradient(-22, -26, 22, 28);
  bg.addColorStop(0,   "#1e2230");
  bg.addColorStop(0.5, "#131720");
  bg.addColorStop(1,   "#0a0c10");
  ctx.fillStyle = bg;
  rr(ctx, -22, -26, 44, 54, 13); ctx.fill();

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  rr(ctx, -22, -26, 44, 54, 13); ctx.stroke();

  // Top specular
  const sg = ctx.createLinearGradient(-18, -26, 18, -12);
  sg.addColorStop(0, "rgba(255,255,255,0.10)");
  sg.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sg;
  rr(ctx, -18, -26, 36, 14, 8); ctx.fill();

  // Side ear-panels
  ctx.fillStyle   = "#1c2130";
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth   = 0.8;
  for (const [ex, ey] of [[-26, -7], [22, -7]] as const) {
    rr(ctx, ex, ey, 4, 10, 2); ctx.fill(); ctx.stroke();
  }

  // Chest panel
  const cg = ctx.createLinearGradient(-9, 14, 9, 22);
  cg.addColorStop(0, "#1a1d2a"); cg.addColorStop(1, "#0e1018");
  ctx.fillStyle   = cg;
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth   = 0.7;
  rr(ctx, -9, 14, 18, 7, 2.5); ctx.fill(); ctx.stroke();

  // Chest indicator dot
  const dotBright = state === "sleep" ? 0.22 : 0.78 + Math.sin(t * 3.2) * 0.22;
  ctx.globalAlpha = dotBright;
  ctx.shadowBlur  = 7; ctx.shadowColor = glowCol;
  ctx.fillStyle   = glowCol;
  ctx.beginPath(); ctx.arc(0, 18, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur  = 0; ctx.globalAlpha = 1;

  // Foot stubs
  ctx.fillStyle   = "#191c26";
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth   = 0.7;
  for (const [fx, fy] of [[-8, 24], [8, 24]] as const) {
    rr(ctx, fx - 6, fy, 12, 5, 3); ctx.fill(); ctx.stroke();
  }

  ctx.restore();
}

function drawSentinelVisor(ctx: CanvasRenderingContext2D, t: number, state: SentinelState) {
  const bob = Math.sin(t * 1.8) * 2;
  ctx.save();
  ctx.translate(40, 40 + bob);

  if (state === "idle" || state === "assist") {
    const br = 0.80 + Math.sin(t * 2.6) * 0.20;
    const vg = ctx.createLinearGradient(-14, 0, 14, 0);
    vg.addColorStop(0, "#ff4400"); vg.addColorStop(0.5, "#ff6b00"); vg.addColorStop(1, "#ff4400");
    // Cyan outer bloom
    ctx.globalAlpha = br * 0.32;
    ctx.shadowBlur = 20; ctx.shadowColor = "#00d4ff";
    ctx.strokeStyle = "#00d4ff"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(14, -2); ctx.stroke();
    // Orange core
    ctx.globalAlpha = br;
    ctx.shadowBlur = 12; ctx.shadowColor = "#ff6b00";
    ctx.strokeStyle = vg; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(14, -2); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  } else if (state === "scan") {
    ctx.globalAlpha = 0.88;
    ctx.shadowBlur = 9; ctx.shadowColor = "#00d4ff";
    ctx.strokeStyle = "#00d4ff"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(14, -2); ctx.stroke();
    // Scan dot
    const sx = Math.sin(t * 2.4) * 12;
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 14; ctx.shadowColor = "#00d4ff";
    ctx.beginPath(); ctx.arc(sx, -2, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  } else if (state === "code") {
    const flicker = Math.sin(t * 47) > 0.85 ? 0.45 : 1;
    ctx.globalAlpha = flicker;
    ctx.shadowBlur = 11; ctx.shadowColor = "#4ade80";
    ctx.strokeStyle = "#4ade80"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(14, -2); ctx.stroke();
    ctx.globalAlpha = flicker * 0.38;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-12, 2.5); ctx.lineTo(12, 2.5); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  } else if (state === "sleep") {
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "#818cf8"; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-12, -2); ctx.quadraticCurveTo(0, 2.5, 12, -2);
    ctx.stroke(); ctx.globalAlpha = 1;

  } else if (state === "dream") {
    const br = 0.82 + Math.sin(t * 1.4) * 0.18;
    ctx.globalAlpha = br;
    ctx.shadowBlur = 13; ctx.shadowColor = "#a78bfa";
    ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 3.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 5, 14, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;

  } else if (state === "threat") {
    const angle = -0.30 + Math.sin(t * 9) * 0.045;
    ctx.save(); ctx.rotate(angle);
    ctx.globalAlpha = 0.96;
    ctx.shadowBlur = 16; ctx.shadowColor = "#ef4444";
    ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 3.2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-14, -1); ctx.lineTo(14, -1); ctx.stroke();
    ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(-10, -5); ctx.lineTo(10, -5); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1; ctx.restore();

  } else if (state === "celebrate") {
    ctx.globalAlpha = 0.96;
    ctx.shadowBlur = 16; ctx.shadowColor = "#facc15";
    ctx.strokeStyle = "#facc15"; ctx.lineWidth = 4.8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, -6, 15, Math.PI * 0.14, Math.PI * 0.86); ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawSentinelEffects(ctx: CanvasRenderingContext2D, t: number, state: SentinelState) {
  if (state === "code") {
    const chars = ["0","1","{","}","<",">","λ","≡","#","∑"];
    ctx.font = "bold 5px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let col = 0; col < 4; col++) {
      const x = 10 + col * 20;
      for (let row = 0; row < 3; row++) {
        const phase = ((t * (1.5 + col * 0.22) + row * 0.9 + col * 1.5) % 3.5) / 3.5;
        const y = 8 + phase * 66;
        ctx.globalAlpha = (1 - phase) * 0.52;
        ctx.fillStyle = row === 0 ? "#ffffff" : "#4ade80";
        ctx.fillText(chars[(col * 3 + row + Math.floor(t * 2)) % chars.length], x, y);
      }
    }
    ctx.globalAlpha = 1;

  } else if (state === "sleep") {
    // ZZZ arcs
    const zzz: [string, number, number][] = [["z",0,0.85],["Z",0.42,1.05],["Z",0.78,1.28]];
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    zzz.forEach(([ch, delay, sc]) => {
      const age = ((t * 0.65 + delay) % 2.7) / 2.7;
      const x   = 58 + Math.sin(age * Math.PI) * 9;
      const y   = 28 - age * 28;
      const a   = age < 0.15 ? age / 0.15 : age > 0.72 ? (1 - age) / 0.28 : 0.82;
      ctx.globalAlpha = a;
      ctx.fillStyle   = "#a78bfa";
      ctx.font = `900 ${Math.round(7 * sc)}px sans-serif`;
      ctx.fillText(ch, x, y);
    });
    ctx.globalAlpha = 1;
    // Crescent moon
    ctx.save();
    ctx.translate(14, 16 + Math.sin(t * 0.85) * 1.5);
    ctx.fillStyle = "#818cf8"; ctx.globalAlpha = 0.88;
    ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(3.5, -2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1; ctx.restore();

  } else if (state === "dream") {
    // Orbiting stars
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let i = 0; i < 5; i++) {
      const ang = t * 0.88 + (i / 5) * Math.PI * 2;
      const sx  = 40 + Math.cos(ang) * 29;
      const sy  = 40 + Math.sin(ang) * 18;
      ctx.globalAlpha = (0.5 + 0.5 * Math.sin(t * 2.5 + i)) * 0.88;
      ctx.fillStyle   = i % 2 === 0 ? "#a78bfa" : "#ffffff";
      ctx.font = `${i === 2 ? 8 : 5}px sans-serif`;
      ctx.fillText(i % 3 === 0 ? "✦" : "★", sx, sy);
    }
    ctx.globalAlpha = 1;

  } else if (state === "threat") {
    // Radial speed lines
    ctx.lineCap = "round";
    for (let i = 0; i < 8; i++) {
      const ang   = (i / 8) * Math.PI * 2 + t * 5.8;
      const phase = ((t * 4.2 + i * 0.98) % 1);
      const r0    = 20 + phase * 18;
      const r1    = r0 + 7 + phase * 5;
      ctx.globalAlpha  = (1 - phase) * 0.62;
      ctx.strokeStyle  = i % 2 === 0 ? "#ef4444" : "#ffffff";
      ctx.lineWidth    = 1.1;
      ctx.beginPath();
      ctx.moveTo(40 + Math.cos(ang) * r0, 40 + Math.sin(ang) * r0 * 0.75);
      ctx.lineTo(40 + Math.cos(ang) * r1, 40 + Math.sin(ang) * r1 * 0.75);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

  } else if (state === "celebrate") {
    // Spark cascade
    for (let i = 0; i < 10; i++) {
      const phase = ((t * 1.9 + i * 0.36) % 1);
      const x     = 12 + drand(i * 7) * 56;
      const y     = 4 + phase * 72;
      ctx.globalAlpha = (1 - phase) * 0.88;
      ctx.fillStyle   = i % 3 === 0 ? "#facc15" : i % 3 === 1 ? "#ff6b00" : "#ffffff";
      ctx.beginPath(); ctx.arc(x, y, 1.8 - phase * 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawSentinelScene(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number) {
  const state = sentinelStateForMode(mode);
  const glowCol = state === "scan"      ? "#00d4ff"
    : state === "code"      ? "#4ade80"
    : state === "sleep"     ? "#818cf8"
    : state === "dream"     ? "#a78bfa"
    : state === "threat"    ? "#ef4444"
    : state === "celebrate" ? "#facc15"
    :                         "#ff6b00";
  glow(ctx, t, glowCol, 40, 44);
  drawSentinelEffects(ctx, t, state);
  drawSentinelBody(ctx, t, state);
  drawSentinelVisor(ctx, t, state);
}

function drawNeuralScene(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number) {
  const accent = "#00d8d6";
  const cx = 40, cy = 40;
  
  // Background neural grid
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 10; i++) {
    const x = 5 + i * 8;
    ctx.beginPath(); ctx.moveTo(x, 5); ctx.lineTo(x, 75); ctx.stroke();
    const y = 5 + i * 8;
    ctx.beginPath(); ctx.moveTo(5, y); ctx.lineTo(75, y); ctx.stroke();
  }
  ctx.restore();

  // Pulse rings
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.5 + i * 0.33) % 1;
    ctx.globalAlpha = (1 - p) * 0.3;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, 10 + p * 30, 0, Math.PI * 2); ctx.stroke();
  }

  // Neural core
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 15);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.5, accent);
  g.addColorStop(1, "transparent");
  ctx.fillStyle = g;
  ctx.globalAlpha = 0.8 + pulse(t, 4) * 0.1;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();

  // Floating particles
  for (let i = 0; i < 12; i++) {
    const a = t * 0.8 + i * 1.5;
    const r = 20 + pulse(t, 2, i) * 5;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    ctx.globalAlpha = 0.6 + pulse(t, 3, i) * 0.3;
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : accent;
    ctx.beginPath(); ctx.arc(px, py, 1.2, 0, Math.PI * 2); ctx.fill();
    
    // Connect particles to core
    if (i % 3 === 0) {
      ctx.globalAlpha = 0.1;
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ══════════════════════════════════════════════════════════════════════════════
//  SCENE COMPOSER
// ══════════════════════════════════════════════════════════════════════════════

function drawScene(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number) {
  if (mode === "neural") {
    drawNeuralScene(ctx, mode, t);
  } else if (mode === "orangerobot") {
    drawOrangeScene(ctx, mode, t);
  } else if (mode === "sentinel" || MODE_SEQUENCE.includes(mode)) {
    drawSentinelScene(ctx, mode, t);
  } else {
    drawNovaScene(ctx, mode, t);
  }
}

// ─── Transition Layer ─────────────────────────────────────────────────────────
function drawLayer(ctx: CanvasRenderingContext2D, mode: AvatarMode, t: number, alpha: number, offset: number, scale: number) {
  ctx.save();
  ctx.globalAlpha=alpha;
  ctx.translate(BASE_SIZE/2+offset,BASE_SIZE/2);
  ctx.scale(scale,scale);
  ctx.translate(-BASE_SIZE/2,-BASE_SIZE/2);
  drawScene(ctx,mode,t);
  ctx.restore();
}

// ─── Component ────────────────────────────────────────────────────────────────
export function BotAvatarCanvas({ mode, size=BASE_SIZE }: { mode: AvatarMode; size?: number }) {
  const canvasRef           = useRef<HTMLCanvasElement>(null);
  const rafRef              = useRef<number>(0);
  const startRef            = useRef<number>(-1);
  const targetModeRef       = useRef<AvatarMode>(mode);
  const previousModeRef     = useRef<AvatarMode|null>(null);
  const transitionStartRef  = useRef<number>(0);

  useEffect(() => {
    if(targetModeRef.current===mode) return;
    previousModeRef.current=targetModeRef.current;
    targetModeRef.current=mode;
    transitionStartRef.current=performance.now();
  },[mode]);

  useEffect(() => {
    const canvas=canvasRef.current;
    if(!canvas) return;
    const mq=window.matchMedia("(prefers-reduced-motion: reduce)");
    const dpr=window.devicePixelRatio||1;
    canvas.width=size*dpr; canvas.height=size*dpr;
    canvas.style.width=`${size}px`; canvas.style.height=`${size}px`;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx) return;
    const renderScale = (size / BASE_SIZE) * dpr;
    ctx.setTransform(renderScale,0,0,renderScale,0,0);

    const draw=(now: DOMHighResTimeStamp)=>{
      if(startRef.current<0) startRef.current=now;
      const t=mq.matches?0:(now-startRef.current)/1000;
      ctx.clearRect(0,0,BASE_SIZE,BASE_SIZE);
      const prev=previousModeRef.current;
      if(prev&&!mq.matches){
        const raw=(now-transitionStartRef.current)/TRANSITION_MS;
        const p=ease(raw);
        if(raw>=1){ previousModeRef.current=null; drawScene(ctx,targetModeRef.current,t); }
        else { drawLayer(ctx,prev,t,1-p,-7*p,1-.04*p); drawLayer(ctx,targetModeRef.current,t,p,7*(1-p),.96+.04*p); }
      } else { drawScene(ctx,targetModeRef.current,t); }
      if(!mq.matches) rafRef.current=requestAnimationFrame(draw);
    };
    rafRef.current=requestAnimationFrame(draw);
    return ()=>{ cancelAnimationFrame(rafRef.current); startRef.current=-1; };
  },[size]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display:"block", background:"transparent" }}
      aria-label={`Astronaut AI — ${MODE_META[mode].label}`}
    />
  );
}
