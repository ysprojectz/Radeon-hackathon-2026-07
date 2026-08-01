"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Zap, ShieldCheck, Globe, Brain, Clock, BarChart3, Mail, ArrowRight, CheckCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AcosLogo } from "@/components/shared/AcosLogo";
import { PRODUCT_FULL_NAME, PRODUCT_SHORT_NAME } from "@/lib/constants";

const QUERY_TYPES = ["Product Demo", "Enterprise Pricing", "Technical Support", "Partnership", "Other"];
const CONTACT_SALES_EMAIL = "sales@example.com";

function ContactModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [queryType, setQueryType] = useState(QUERY_TYPES[0]);
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const body = `Name: ${name}\r\nContact No: ${contact}\r\nQuery Type: ${queryType}`;
    window.location.href = `mailto:${CONTACT_SALES_EMAIL}?subject=${encodeURIComponent("Contact Sales Enquiry")}&body=${encodeURIComponent(body)}`;
    onClose();
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md border border-white/10 bg-[var(--bg-dashboard)]">
        <DialogTitle className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-ui)" }}>Contact Sales</DialogTitle>
        <DialogDescription className="text-sm text-white/50">Fill in your details and we&apos;ll get back to you shortly.</DialogDescription>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {[
            { label: "Full Name", value: name, setter: setName, type: "text", ph: "John Smith" },
            { label: "Contact Number", value: contact, setter: setContact, type: "tel", ph: "+971 50 123 4567" },
          ].map(({ label, value, setter, type, ph }) => (
            <div key={label}>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-white/40">{label} <span className="text-[var(--status-danger)]">*</span></label>
              <input type={type} required value={value} onChange={e => setter(e.target.value)} placeholder={ph}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder:text-white/20 outline-none focus:border-brand-primary/50 focus:bg-white/[0.06] transition-all" />
            </div>
          ))}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-white/40">Query Type <span className="text-[var(--status-danger)]">*</span></label>
            <select value={queryType} onChange={e => setQueryType(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-white outline-none focus:border-brand-primary/50 transition-all">
              {QUERY_TYPES.map(t => <option key={t} value={t} className="bg-[var(--bg-dashboard)]">{t}</option>)}
            </select>
          </div>
          <button type="submit"
            className="mt-2 w-full rounded-xl bg-brand-primary px-6 py-3 text-sm font-bold text-white transition-all hover:bg-brand-primary-hover">
            Send Enquiry →
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const TICKER = [
  "Enterprise-Grade Security", "99.9% Due-Time Reliability",
  "End-to-End Encryption", "Global Scale Ready", "Sub-2s Processing",
  "Dual-Agent Validation", "TOTP 2FA Protected", "ISO 27001 Compliant", "24/7 Support",
];

function Counter({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    const observer = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      observer.disconnect();
      let v = 0;
      const step = Math.ceil(target / 60);
      timer = setInterval(() => { v += step; if (v >= target) { setCount(target); clearInterval(timer); } else setCount(v); }, 16);
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); clearInterval(timer); };
  }, [target]);
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}

/* ─── Animated grid background ─────────────────────────────────────────────── */
function GridCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    let raf = 0;
    let width = 0;
    let height = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const resize = () => {
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      c.width = Math.floor(width * dpr);
      c.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(c);
    const draw = (now: number) => {
      if (width === 0 || height === 0) { raf = requestAnimationFrame(draw); return; }
      ctx.clearRect(0, 0, width, height);
      const GRID = 56;
      const drift = reduceMotion.matches ? 0 : (now * 0.006) % GRID;
      ctx.strokeStyle = "rgba(0,216,214,0.045)";
      ctx.lineWidth = 0.6;
      for (let x = -GRID + drift; x < width + GRID; x += GRID) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = -GRID + drift * 0.6; y < height + GRID; y += GRID) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      const pulseX = ((now * 0.018) % (width + GRID * 2)) - GRID;
      const g = ctx.createLinearGradient(pulseX, 0, pulseX, height);
      g.addColorStop(0, "rgba(0,216,214,0)");
      g.addColorStop(0.5, "rgba(0,216,214,0.18)");
      g.addColorStop(1, "rgba(0,216,214,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(pulseX, 0); ctx.lineTo(pulseX, height); ctx.stroke();

      const sweep = ((now * 0.012) % (width + height)) - height;
      const d = ctx.createLinearGradient(sweep, height, sweep + height, 0);
      d.addColorStop(0, "rgba(255,138,42,0)");
      d.addColorStop(0.5, "rgba(255,138,42,0.08)");
      d.addColorStop(1, "rgba(0,216,214,0)");
      ctx.strokeStyle = d; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sweep, height); ctx.lineTo(sweep + height, 0); ctx.stroke();

      if (!reduceMotion.matches) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const restart = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    reduceMotion.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      reduceMotion.removeEventListener("change", restart);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" />;
}

/* ─── Live dashboard widget ─────────────────────────────────────────────────── */
function LiveDashWidget() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2200);
    return () => clearInterval(id);
  }, []);
  const rows = [
    { ref: "CLM-2847", amount: "₹92,400", status: "SETTLED", color: "text-emerald-400", dot: "bg-emerald-400" },
    { ref: "CLM-2848", amount: "₹24,800", status: "REVIEW", color: "text-amber-400", dot: "bg-amber-400" },
    { ref: "CLM-2849", amount: "₹2,15,000", status: "SETTLED", color: "text-emerald-400", dot: "bg-emerald-400" },
    { ref: "CLM-2850", amount: "₹53,200", status: "REVIEW", color: "text-amber-400", dot: "bg-amber-400" },
  ];
  const shown = (tick % 4) + 1;
  return (
    <div className="relative w-full max-w-[400px] rounded-2xl border border-white/10 bg-[var(--bg-dashboard)]/90 p-5 shadow-[0_40px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-brand-primary/60 to-transparent" />
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-brand-primary/70">Live Adjudication</p>
          <p className="mt-0.5 text-sm font-bold text-white" style={{ fontFamily: "var(--font-ui)" }}>{PRODUCT_SHORT_NAME}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span className="text-[10px] font-semibold text-emerald-400">LIVE</span>
        </div>
      </div>
      <div className="space-y-2">
        {rows.slice(0, shown).map((r, i) => (
          <div key={r.ref}
            className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-all"
            style={{ animation: i === shown - 1 ? "fadeSlideIn 0.4s ease-out" : "none" }}>
            <div className="flex items-center gap-2.5">
              <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
              <span className="font-mono text-[11px] text-white/60">{r.ref}</span>
            </div>
            <span className="font-mono text-[11px] font-bold text-white/80">{r.amount}</span>
            <span className={`text-[10px] font-black ${r.color}`}>{r.status}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[["1,284", "Intake"], ["97.8%", "Auto-adj"], ["₹6.4 Cr", "Settled"]].map(([v, l]) => (
          <div key={l} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-2.5 text-center">
            <p className="font-mono text-sm font-bold text-white">{v}</p>
            <p className="mt-0.5 text-[9px] uppercase tracking-wider text-white/35">{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroClaimsBot() {
  return (
    <div className="claims-bot-stage" aria-label="Animated ACOS claims review bot">
      <div className="workflow-card workflow-card-doc">
        <span>CLAIM PDF</span>
        <i />
        <i />
        <b />
      </div>
      <div className="workflow-card workflow-card-policy">
        <span>POLICY</span>
        <i />
        <b />
      </div>
      <div className="workflow-card workflow-card-audit">
        <span>AUDIT</span>
        <i />
        <i />
        <b />
      </div>

      <div className="bot-scan-beam" />
      <div className="bot-workline bot-workline-one" />
      <div className="bot-workline bot-workline-two" />

      <div className="claims-bot">
        <div className="bot-ear bot-ear-left" />
        <div className="bot-ear bot-ear-right" />
        <div className="bot-head">
          <div className="bot-spark" />
          <div className="bot-face">
            <span className="bot-eye bot-eye-left" />
            <span className="bot-eye bot-eye-right" />
            <span className="bot-mouth" />
          </div>
        </div>
        <div className="bot-body">
          <span className="bot-core" />
        </div>
        <div className="bot-arm bot-arm-left" />
        <div className="bot-arm bot-arm-right" />
      </div>

      <div className="approval-chip approval-chip-one">MATCH</div>
      <div className="approval-chip approval-chip-two">OK</div>
    </div>
  );
}

/* ─── Feature card ──────────────────────────────────────────────────────────── */
function FeatureCard({ icon: Icon, title, description, accent }: {
  icon: React.ElementType; title: string; description: string; accent: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[var(--bg-primary)] p-7 transition-all duration-500 hover:border-white/[0.14] hover:bg-[var(--bg-secondary)]"
      style={{ "--card-accent": accent } as React.CSSProperties}>
      <div className="absolute inset-x-0 top-0 h-[1px] transition-all duration-500"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}60, transparent)`, opacity: 0 }}
        ref={el => { if (el) { const p = el.parentElement; p?.addEventListener("mouseenter", () => el.style.opacity = "1"); p?.addEventListener("mouseleave", () => el.style.opacity = "0"); } }} />
      <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-0 blur-3xl transition-all duration-700 group-hover:opacity-20"
        style={{ background: accent }} />
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08]"
        style={{ background: `${accent}18` }}>
        <Icon className="h-5 w-5" style={{ color: accent }} strokeWidth={2} />
      </div>
      <h3 className="mb-2.5 text-[15px] font-bold text-white leading-snug" style={{ fontFamily: "var(--font-ui)" }}>{title}</h3>
      <p className="text-[13px] leading-relaxed text-white/40">{description}</p>
      <div className="absolute bottom-0 left-0 right-0 h-[1px] scale-x-0 transition-transform duration-500 group-hover:scale-x-100"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}50, transparent)` }} />
    </div>
  );
}

/* ─── Stat ring ─────────────────────────────────────────────────────────────── */
function StatRing({ value, label, color, target, suffix }: {
  value?: string; label: string; color: string; target?: number; suffix?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 px-6">
      <p className="font-mono text-5xl font-black tabular-nums text-white" style={{ color }}>
        {target !== undefined ? <Counter target={target} suffix={suffix} /> : value}
      </p>
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.25em] text-white/35">{label}</p>
    </div>
  );
}

export default function LandingPage() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <div className="page-scroll min-h-screen bg-[var(--bg-dashboard)] font-sans text-white antialiased overflow-x-hidden scroll-smooth">
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes marquee { from { transform:translate3d(0,0,0); } to { transform:translate3d(-50%,0,0); } }
        @keyframes landingFieldFlow {
          0% { background-position:0% 50%, 50% 0%, 0 0; transform:translate3d(0,0,0) scale(1); }
          50% { background-position:100% 50%, 45% 100%, 0 0; transform:translate3d(0,-1.5%,0) scale(1.015); }
          100% { background-position:0% 50%, 50% 0%, 0 0; transform:translate3d(0,0,0) scale(1); }
        }
        @keyframes landingBandDrift {
          from { transform:translate3d(-4%,0,0) rotate(-4deg); }
          to { transform:translate3d(4%,0,0) rotate(-4deg); }
        }
        @keyframes botReviewFloat { 0%{transform:translate3d(-50%,-50%,0) rotate(-0.8deg);} 50%{transform:translate3d(-50%,calc(-50% - 13px),0) rotate(0.9deg);} 100%{transform:translate3d(-50%,-50%,0) rotate(-0.8deg);} }
        @keyframes botHeadLook { 0%{transform:translate3d(-2px,0,0) rotate(-2.2deg);} 33%{transform:translate3d(3px,-1px,0) rotate(2.4deg);} 66%{transform:translate3d(1px,2px,0) rotate(0.8deg);} 100%{transform:translate3d(-2px,0,0) rotate(-2.2deg);} }
        @keyframes botBlink { 0%,44%,52%,100%{transform:scaleY(1);} 48%{transform:scaleY(0.18);} }
        @keyframes botEyeTrack { 0%{transform:translate3d(-3px,-2px,0);} 33%{transform:translate3d(3px,-2px,0);} 66%{transform:translate3d(2px,3px,0);} 100%{transform:translate3d(-3px,-2px,0);} }
        @keyframes botMouthWork { 0%{transform:translateX(-50%) scale3d(.75,1,1);border-radius:0 0 10px 10px;} 35%{transform:translateX(-50%) scale3d(1.2,.45,1);border-radius:999px;} 70%{transform:translateX(-50%) scale3d(.85,1.18,1);border-radius:50%;} 100%{transform:translateX(-50%) scale3d(.75,1,1);border-radius:0 0 10px 10px;} }
        @keyframes botCoreActive { 0%{transform:translateX(-50%) scale(1);opacity:.82;} 50%{transform:translateX(-50%) scale(1.22);opacity:1;} 100%{transform:translateX(-50%) scale(1);opacity:.82;} }
        @keyframes botLeftArmReview { 0%{transform:rotate(-18deg) translate3d(0,0,0);} 38%{transform:rotate(-36deg) translate3d(-8px,-9px,0);} 72%{transform:rotate(-9deg) translate3d(5px,2px,0);} 100%{transform:rotate(-18deg) translate3d(0,0,0);} }
        @keyframes botRightArmStamp { 0%{transform:rotate(18deg) translate3d(0,0,0);} 42%{transform:rotate(38deg) translate3d(8px,-8px,0);} 74%{transform:rotate(8deg) translate3d(-4px,4px,0);} 100%{transform:rotate(18deg) translate3d(0,0,0);} }
        @keyframes botScan { 0%{opacity:0;transform:translate(-70px,-34px) rotate(4deg) scaleX(.35);} 18%,72%{opacity:1;} 100%{opacity:0;transform:translate(132px,44px) rotate(4deg) scaleX(1);} }
        @keyframes docReview { 0%,100%{transform:translate3d(0,0,0) rotate(-7deg) scale(.98);opacity:.72;} 45%{transform:translate3d(8px,-10px,0) rotate(-2deg) scale(1.04);opacity:1;} }
        @keyframes policyReview { 0%,100%{transform:translate3d(0,0,0) rotate(7deg) scale(.98);opacity:.76;} 50%{transform:translate3d(-10px,-8px,0) rotate(2deg) scale(1.04);opacity:1;} }
        @keyframes auditReview { 0%,100%{transform:translate3d(0,0,0) rotate(5deg) scale(.98);opacity:.68;} 50%{transform:translate3d(-8px,10px,0) rotate(0deg) scale(1.04);opacity:1;} }
        @keyframes cardSweep { 0%{transform:translate3d(-120%,0,0);opacity:0;} 38%,56%{opacity:1;} 100%{transform:translate3d(120%,0,0);opacity:0;} }
        @keyframes checkPulse { 0%,44%,100%{transform:scale(1);border-color:rgba(16,185,129,.75);} 54%,70%{transform:scale(1.12);border-color:#52f2a4;box-shadow:0 0 20px rgba(16,185,129,.35);} }
        @keyframes workPulse { 0%{transform:scaleX(0);opacity:0;} 25%,65%{opacity:1;} 100%{transform:scaleX(1);opacity:0;} }
        @keyframes chipPop { 0%,34%,100%{opacity:0;transform:translateY(8px) scale(.88);} 44%,72%{opacity:1;transform:translateY(0) scale(1);} }
        @keyframes heroFadeUp { from{opacity:0;transform:translateY(28px);} to{opacity:1;transform:translateY(0);} }
        .landing-flow-field { position:absolute; inset:-18%; pointer-events:none; background:linear-gradient(116deg, rgba(0,216,214,.12), transparent 28%, rgba(255,107,0,.10) 52%, transparent 76%, rgba(59,130,246,.08)), conic-gradient(from 180deg at 52% 44%, transparent, rgba(0,216,214,.10), transparent, rgba(255,107,0,.09), transparent), linear-gradient(180deg, rgba(3,7,18,.35), transparent 42%, rgba(3,7,18,.82)); background-size:180% 180%, 140% 140%, 100% 100%; opacity:.86; filter:saturate(1.08); animation:landingFieldFlow 32s ease-in-out infinite; will-change:transform,background-position; transform:translate3d(0,0,0); }
        .landing-flow-field:after { content:""; position:absolute; inset:18% -12%; background:linear-gradient(92deg, transparent 0%, rgba(0,216,214,.08) 32%, rgba(255,255,255,.035) 50%, rgba(255,107,0,.07) 67%, transparent 100%); opacity:.72; animation:landingBandDrift 18s ease-in-out infinite alternate; transform:translate3d(0,0,0) rotate(-4deg); will-change:transform; }
        .landing-vignette { position:absolute; inset:0; pointer-events:none; background:radial-gradient(ellipse at center, transparent 0%, transparent 48%, rgba(3,7,18,.50) 78%, rgba(3,7,18,.85) 100%), linear-gradient(180deg, transparent 0%, rgba(3,7,18,.78) 100%); }
        .landing-cta-field { position:absolute; inset:-22%; pointer-events:none; background:linear-gradient(120deg, transparent 20%, rgba(255,107,0,.12) 42%, rgba(0,216,214,.07) 56%, transparent 78%), conic-gradient(from 90deg at 50% 50%, transparent, rgba(255,107,0,.09), transparent, rgba(0,216,214,.07), transparent); background-size:170% 170%, 150% 150%; animation:landingFieldFlow 36s ease-in-out infinite reverse; will-change:transform,background-position; transform:translate3d(0,0,0); }
        .landing-marquee-track { animation:marquee 36s linear infinite; will-change:transform; transform:translate3d(0,0,0); }
        .hero-line-1 { animation: heroFadeUp 0.7s ease-out both; }
        .hero-line-2 { animation: heroFadeUp 0.7s 0.12s ease-out both; }
        .hero-line-3 { animation: heroFadeUp 0.7s 0.24s ease-out both; }
        .hero-line-4 { animation: heroFadeUp 0.7s 0.36s ease-out both; }
        .hero-widget  { animation: heroFadeUp 0.9s 0.2s ease-out both; }
        .feature-card-hover:hover .beam { opacity:1!important; transform:scaleX(1)!important; }
        .claims-bot-stage { position:relative; width:360px; height:270px; margin-top:-6px; contain:layout paint; transform:translate3d(0,0,0); }
        .claims-bot, .bot-head, .bot-eye:after, .bot-mouth, .bot-core, .bot-arm, .workflow-card, .workflow-card:before, .workflow-card b, .bot-scan-beam, .bot-workline, .approval-chip, .landing-marquee-track { backface-visibility:hidden; transform-style:preserve-3d; }
        .claims-bot { position:absolute; z-index:3; left:50%; top:52%; width:168px; height:180px; animation:botReviewFloat 6s ease-in-out infinite; filter:drop-shadow(0 24px 32px rgba(255,91,24,.24)); will-change:transform; }
        .bot-head { position:absolute; left:18px; top:8px; width:132px; height:110px; border-radius:34px 38px 32px 32px; background:#ff641f; box-shadow:inset 0 -10px 0 rgba(166,52,18,.18), 0 0 28px rgba(255,100,31,.25); transform-origin:50% 88%; animation:botHeadLook 6.6s ease-in-out infinite; }
        .bot-spark { position:absolute; right:-3px; top:-14px; width:44px; height:34px; border-radius:80% 18% 70% 20%; background:#ff641f; transform:rotate(21deg); }
        .bot-face { position:absolute; left:18px; right:18px; top:28px; height:58px; border-radius:22px; background:#1d152b; box-shadow:inset 0 0 0 1px rgba(255,255,255,.05); }
        .bot-eye { position:absolute; top:21px; width:22px; height:18px; border-radius:50%; background:#fff; animation:botBlink 5s infinite; transform-origin:center; overflow:hidden; }
        .bot-eye:after { content:""; position:absolute; left:9px; top:6px; width:6px; height:6px; border-radius:50%; background:#1d152b; animation:botEyeTrack 6.6s ease-in-out infinite; }
        .bot-eye-left { left:25px; }
        .bot-eye-right { right:25px; }
        .bot-mouth { position:absolute; left:50%; bottom:14px; width:15px; height:7px; transform:translateX(-50%) scale3d(.75,1,1); transform-origin:center; border-radius:0 0 10px 10px; background:#fff; animation:botMouthWork 6.6s ease-in-out infinite; will-change:transform,border-radius; }
        .bot-ear { position:absolute; top:58px; width:13px; height:32px; border-radius:8px; background:#21172f; }
        .bot-ear-left { left:3px; }
        .bot-ear-right { right:3px; }
        .bot-body { position:absolute; left:54px; top:116px; width:60px; height:54px; border-radius:28px 28px 18px 18px; background:#ff641f; box-shadow:inset 0 -8px 0 rgba(166,52,18,.16); }
        .bot-core { position:absolute; left:50%; top:18px; width:15px; height:15px; transform:translateX(-50%); border-radius:50%; background:#fff; box-shadow:0 0 18px rgba(255,255,255,.5); animation:botCoreActive 3.4s ease-in-out infinite; }
        .bot-arm { position:absolute; top:127px; width:28px; height:18px; border-radius:14px; background:#ff641f; transform-origin:50% 50%; }
        .bot-arm-left { left:24px; transform:rotate(-18deg); animation:botLeftArmReview 6.6s ease-in-out infinite; }
        .bot-arm-right { right:24px; transform:rotate(18deg); animation:botRightArmStamp 6.6s ease-in-out infinite; }
        .workflow-card { position:absolute; z-index:2; width:96px; border:1px solid rgba(255,255,255,.1); border-radius:8px; background:rgba(8,10,15,.62); backdrop-filter:blur(12px); padding:10px; box-shadow:0 18px 36px rgba(0,0,0,.28); pointer-events:none; overflow:hidden; }
        .workflow-card:before { content:""; position:absolute; inset:0; background:linear-gradient(100deg, transparent 20%, rgba(0,255,204,.16) 48%, transparent 76%); animation:cardSweep 4.6s ease-in-out infinite; }
        .workflow-card span { display:block; margin-bottom:8px; font-size:9px; font-weight:900; letter-spacing:.18em; color:rgba(255,255,255,.62); }
        .workflow-card i { display:block; height:4px; border-radius:999px; background:rgba(255,255,255,.16); margin-top:5px; }
        .workflow-card b { display:block; width:22px; height:22px; margin-top:9px; border-radius:50%; border:2px solid rgba(16,185,129,.75); position:relative; animation:checkPulse 4.8s ease-in-out infinite; }
        .workflow-card b:after { content:""; position:absolute; left:5px; top:5px; width:8px; height:4px; border-left:2px solid #10b981; border-bottom:2px solid #10b981; transform:rotate(-45deg); }
        .workflow-card-doc { left:10px; top:70px; animation:docReview 5.2s ease-in-out infinite; }
        .workflow-card-policy { right:6px; top:48px; animation:policyReview 5.6s ease-in-out infinite; }
        .workflow-card-audit { right:34px; bottom:0; animation:auditReview 5s ease-in-out infinite; }
        .bot-scan-beam { position:absolute; z-index:1; left:112px; top:96px; width:132px; height:2px; border-radius:999px; background:linear-gradient(90deg, transparent, #00ffcc, #ff8a2a, transparent); box-shadow:0 0 18px rgba(0,255,204,.5); transform-origin:left center; animation:botScan 3.8s linear infinite; will-change:transform,opacity; }
        .bot-workline { position:absolute; height:1px; border-radius:999px; background:linear-gradient(90deg, transparent, rgba(0,212,255,.65), transparent); transform-origin:left center; animation:workPulse 3.2s ease-in-out infinite; }
        .bot-workline-one { z-index:1; left:82px; top:92px; width:168px; transform:rotate(4deg); }
        .bot-workline-two { z-index:1; left:104px; top:188px; width:144px; transform:rotate(-14deg); animation-delay:1.2s; }
        .approval-chip { position:absolute; z-index:4; border-radius:999px; border:1px solid rgba(16,185,129,.3); background:rgba(16,185,129,.12); padding:5px 9px; font-size:9px; font-weight:900; letter-spacing:.14em; color:#52f2a4; box-shadow:0 0 18px rgba(16,185,129,.16); animation:chipPop 4.8s ease-in-out infinite; }
        .approval-chip-one { left:34px; bottom:46px; }
        .approval-chip-two { right:28px; top:20px; animation-delay:1.8s; }
        @media (prefers-reduced-motion: reduce) {
          .landing-flow-field, .landing-flow-field:after, .landing-cta-field, .landing-marquee-track, .claims-bot, .bot-head, .bot-eye, .bot-eye:after, .bot-mouth, .bot-core, .bot-arm, .workflow-card, .workflow-card:before, .workflow-card b, .bot-scan-beam, .bot-workline, .approval-chip, .hero-line-1, .hero-line-2, .hero-line-3, .hero-line-4, .hero-widget {
            animation-duration:.01ms!important;
            animation-iteration-count:1!important;
            transition-duration:.01ms!important;
          }
        }
      `}</style>

      <ContactModal open={contactOpen} onClose={() => setContactOpen(false)} />

      {/* ── NAV ──────────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[var(--bg-dashboard)]/90 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <AcosLogo showLabel />
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setContactOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-[13px] font-semibold text-white/70 transition-all hover:border-white/[0.18] hover:text-white">
            Contact Sales
          </button>
          <Link href="/login"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-primary px-5 py-2.5 text-[13px] font-bold text-white transition-all hover:bg-brand-primary-hover">
            Access Portal <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[calc(100vh-65px)] overflow-hidden flex items-center">
        {/* Background layers */}
        <GridCanvas />
        <div className="absolute -left-64 top-0 h-[600px] w-[600px] rounded-full bg-brand-primary/[0.04] blur-[120px] pointer-events-none" />
        <div className="absolute -right-32 bottom-0 h-[500px] w-[500px] rounded-full bg-brand-primary/[0.06] blur-[100px] pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg-dashboard)]/80 pointer-events-none" />

        <div className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between gap-16 px-6 py-24">
          {/* Left — copy */}
          <div className="flex-1 max-w-2xl">
            <div className="hero-line-1 mb-6 inline-flex items-center gap-2 rounded-full border border-brand-primary/25 bg-brand-primary/8 px-4 py-2">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-primary" />
              <span className="text-[11px] font-black uppercase tracking-[0.3em] text-brand-primary">{PRODUCT_FULL_NAME}</span>
            </div>

            <h1 className="hero-line-2 mb-10 leading-[1.04] tracking-normal" style={{ fontFamily: "var(--font-ui)" }}>
              <span className="block text-5xl font-black text-white md:text-6xl xl:text-7xl">
                Claims Processing
              </span>
              <span className="block text-5xl font-black md:text-6xl xl:text-7xl">
                <span className="text-brand-primary">
                  Built for Control.
                </span>
              </span>
            </h1>

            <div className="hero-line-4 flex flex-col sm:flex-row gap-3">
              <Link href="/login"
                className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-brand-primary px-8 py-4 text-[14px] font-bold text-white transition-all hover:bg-brand-primary-hover hover:gap-3.5">
                Access Portal
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <button onClick={() => setContactOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/[0.10] bg-white/[0.04] px-8 py-4 text-[14px] font-semibold text-white/70 transition-all hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-white">
                <Mail className="h-4 w-4" /> Contact Sales
              </button>
            </div>

            <div className="hero-line-4 mt-10 flex items-center gap-8">
              {[["99.9%", "Uptime"], ["< 2s", "Processing"], ["24/7", "Event Ready"]].map(([v, l]) => (
                <div key={l}>
                  <p className="font-mono text-xl font-black text-white">{v}</p>
                  <p className="mt-0.5 text-[10px] uppercase tracking-widest text-white/30">{l}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right — live widget + floating bot */}
          <div className="hero-widget hidden lg:flex flex-col items-center gap-4 flex-shrink-0">
            <LiveDashWidget />
            <HeroClaimsBot />
          </div>
        </div>
      </section>

      {/* ── TICKER ───────────────────────────────────────────────────────────── */}
      <div className="overflow-hidden border-y border-white/[0.06] bg-[var(--bg-dashboard)] py-3.5">
        <div className="flex whitespace-nowrap" style={{ animation: "marquee 30s linear infinite" }}>
          {[...TICKER, ...TICKER].map((item, i) => (
            <span key={i} className="mx-7 inline-flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-widest text-white/35">
              <CheckCircle className="h-3 w-3 text-brand-primary/60 shrink-0" />
              {item}
            </span>
          ))}
        </div>
      </div>

      {/* ── FEATURES ─────────────────────────────────────────────────────────── */}
      <section className="py-28 px-6">
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 max-w-xl">
            <p className="mb-3 text-[11px] font-black uppercase tracking-[0.3em] text-brand-primary">Core Capabilities</p>
            <h2 className="text-3xl font-black leading-tight text-white md:text-4xl xl:text-5xl" style={{ fontFamily: "var(--font-ui)" }}>
              Enterprise-Grade<br />
              <span className="text-white/40">Claims Infrastructure</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { icon: Brain, title: "Dual Review Validation", desc: "Rules checks and assistant review compare every claim. Disagreements trigger human review with no silent failures." },
              { icon: Globe, title: "Global Scalability", desc: "Flexible architecture supporting multiple regions, currencies, and regulatory frameworks out of the box." },
              { icon: ShieldCheck, title: "Fraud Prevention", desc: "Suspicious billing patterns, duplicate claims, and regulatory risks are flagged before settlement." },
              { icon: BarChart3, title: "Real-Time Dashboard", desc: "Live journey flow, due-time tracking, metrics, and volume charts. Every claim is visible the moment it enters." },
              { icon: Clock, title: "Due-Time Control", desc: "Configurable processing targets with automatic tracking, overdue alerts, and compliance reporting." },
              { icon: Zap, title: "Enterprise Security", desc: "TOTP two-factor auth, role-based access (Admin / Adjuster / Reviewer / Compliance), and immutable audit trails." },
              // Single brand accent across every card (DESIGN_SYSTEM.md 1.1/1.2) — previously each
              // card had its own arbitrary hex (emerald/blue/red/amber/violet/cyan), the exact
              // "rainbow spread" anti-pattern the spec calls out. None of these are actual
              // success/warning/danger states, so they share the one deliberate brand accent.
            ].map(p => <FeatureCard key={p.title} icon={p.icon} title={p.title} description={p.desc} accent="#2563EB" />)}
          </div>
        </div>
      </section>

      {/* ── STATS ────────────────────────────────────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-[var(--bg-dashboard)]">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/[0.06]">
            <StatRing target={50000} suffix="+" label="Claims Processed & Tested" color="#2563EB" />
            <StatRing value="< 2s" label="Target Processing Time" color="#2563EB" />
            <StatRing value="99.9%" label="Uptime Target" color="#2563EB" />
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-32 px-6">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[800px] rounded-full bg-brand-primary/[0.06] blur-[120px]" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[600px] rounded-full bg-brand-primary/[0.04] blur-[80px]" />
        </div>
        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <p className="mb-5 text-[11px] font-black uppercase tracking-[0.35em] text-brand-primary/70">Get Started</p>
          <h2 className="mb-12 text-4xl font-black leading-[1.06] text-white md:text-5xl xl:text-6xl" style={{ fontFamily: "var(--font-ui)" }}>
            Ready to Transform Your<br />
            <span className="text-brand-primary">Claims Processing?</span>
          </h2>
          <Link href="/login"
            className="group inline-flex items-center gap-3 rounded-2xl bg-brand-primary px-12 py-5 text-[15px] font-bold text-white transition-all hover:bg-brand-primary-hover hover:gap-4">
            Get Started Now
            <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] py-10 px-6">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between gap-5">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-bold text-white/40">{PRODUCT_SHORT_NAME} © 2026</span>
          </div>
          <div className="flex gap-7 text-[12px] text-white/30">
            <a href="#" className="transition-colors hover:text-white/60">Privacy Policy</a>
            <a href="#" className="transition-colors hover:text-white/60">Terms of Service</a>
            <a href="mailto:sales@example.com" className="transition-colors hover:text-white/60">Contact Us</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
