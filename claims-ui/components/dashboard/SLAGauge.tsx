"use client";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";

interface Props {
  complianceRate?: number;
  targetMs?:       number;
  avgMs?:          number;
  isLoading:       boolean;
}

const ARC_R   = 48;
const ARC_CX  = 60;
const ARC_CY  = 58;
const ARC_LEN = Math.PI * ARC_R; // half-circle circumference ≈ 150.8

// Arc color definitions matching analytics theme
function arcColor(rate: number) {
  if (rate >= 99) return { 
    stroke: "var(--brand-secondary)", 
    glow: "var(--brand-secondary-glow)", 
    label: "Excellent", 
    text: "var(--brand-secondary)",
    accent: "var(--brand-secondary)"
  };
  if (rate >= 95) return { 
    stroke: "var(--brand-warning)", 
    glow: "var(--brand-warning-glow)", 
    label: "Acceptable", 
    text: "var(--brand-warning)",
    accent: "var(--brand-warning)"
  };
  return { 
    stroke: "var(--brand-danger)", 
    glow: "var(--brand-danger-glow)", 
    label: "At Risk", 
    text: "var(--brand-danger)",
    accent: "var(--brand-danger)"
  };
}

export function SLAGauge({
  complianceRate = 100,
  targetMs       = 2000,
  avgMs          = 0,
  isLoading,
}: Props) {
  const pct    = Math.min(100, Math.max(0, complianceRate));
  const c      = arcColor(pct);
  const offset = ARC_LEN * (1 - pct / 100);
  const needleAngle = -90 + (pct / 100) * 180;

  return (
    <Card variant="dashboard" className="h-full min-h-0">
      {/* Violet theme - top accent and glow (using ambient color from arc) */}
      <CardAccent style={{ background: `linear-gradient(90deg, transparent, ${c.accent}50, transparent)` }} />
      <CardGlow className="-bottom-8 right-0 w-40 h-40" style={{ background: c.glow, opacity: 0.20 }} />

      <div className="relative p-5">
        {/* Header */}
        <div className="dashboard-panel-header mb-4">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.stroke }} />
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">
              SLA Compliance
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="animate-pulse flex flex-col items-center gap-3 py-4">
            <div className="w-[120px] h-[72px] rounded-full bg-white/10" />
            <div className="h-2 w-20 rounded-full bg-white/10" />
          </div>
        ) : (
          <>
            {/* SVG Gauge */}
            <div className="flex justify-center">
      <svg viewBox="0 0 120 68" className="w-[160px]" aria-label={`Due time: ${pct.toFixed(1)}%`}>
                <defs aria-hidden="true">
                  <filter id="arc-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2.5" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>

                {/* Track */}
                <path
                  aria-hidden="true"
                  d={`M ${ARC_CX - ARC_R} ${ARC_CY} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_CX + ARC_R} ${ARC_CY}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="9"
                  strokeLinecap="round"
                />

                {/* Fill arc with glow */}
                <path
                  aria-hidden="true"
                  d={`M ${ARC_CX - ARC_R} ${ARC_CY} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_CX + ARC_R} ${ARC_CY}`}
                  fill="none"
                  stroke={c.stroke}
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={ARC_LEN}
                  strokeDashoffset={offset}
                  filter="url(#arc-glow)"
                  style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
                />

                {/* Compass-style needle */}
                <g aria-hidden="true" transform={`rotate(${needleAngle} ${ARC_CX} ${ARC_CY})`}>
                  <line
                    x1={ARC_CX}
                    y1={ARC_CY}
                    x2={ARC_CX}
                    y2={ARC_CY - 40}
                    stroke={c.stroke}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <circle cx={ARC_CX} cy={ARC_CY} r="4" fill={c.stroke} />
                </g>

                {/* Percentage */}
                <text aria-hidden="true" x={ARC_CX} y={ARC_CY - 6} textAnchor="middle" dominantBaseline="central"
                  fontSize="18" fontWeight="900" fill="white" fontFamily="monospace">
                  {pct.toFixed(1)}%
                </text>

                {/* Status */}
                <text aria-hidden="true" x={ARC_CX} y={ARC_CY + 10} textAnchor="middle" dominantBaseline="central"
                  fontSize="7" fontWeight="700" fill={c.text} letterSpacing="0.1em">
                  {c.label.toUpperCase()}
                </text>
              </svg>
            </div>

            {/* Stats */}
            <div className="mt-3 pt-4 border-t border-white/[0.06] space-y-2.5">
              <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30">Due-Time Target</span>
                <span className="text-sm font-black font-mono text-white tabular-nums">
                  &lt;{targetMs >= 1000 ? `${(targetMs / 1000).toFixed(0)}s` : `${targetMs}ms`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/30">Avg Process</span>
                <span
                  className="text-sm font-black font-mono tabular-nums"
                  style={{ color: avgMs > 0 ? (avgMs <= targetMs ? "var(--brand-secondary)" : "var(--brand-danger)") : "rgba(255,255,255,0.25)" }}
                >
                  {avgMs > 0 ? `${avgMs.toLocaleString()}ms` : "—"}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
