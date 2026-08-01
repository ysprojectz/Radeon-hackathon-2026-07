"use client";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiAgentConsensusProps {
  agreementScore: number;
  hasConflict: boolean;
  details?: (string | number)[];
  primaryModel?: string;
  shadowModel?: string;
}

export function MultiAgentConsensus({
  agreementScore,
  hasConflict,
  details = [],
  primaryModel = "Agent B",
  shadowModel = "Agent C"
}: MultiAgentConsensusProps) {
  const scorePct = Math.round(agreementScore * 100);
  
  return (
    <div className="glass-card rounded-2xl border border-white/10 bg-black/20 backdrop-blur-md overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400">
            <ShieldCheck size={18} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white/90">Multi-Agent Consensus</h3>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-tighter">Agreement</p>
            <p className={cn(
              "text-lg font-mono font-black tabular-nums",
              scorePct >= 95 ? "text-emerald-400" : scorePct >= 80 ? "text-amber-400" : "text-red-400"
            )}>
              {scorePct}%
            </p>
          </div>
          <div className="h-8 w-[1px] bg-white/10" />
          <div className={cn(
            "px-3 py-1.5 rounded-xl border font-bold text-[10px] uppercase tracking-wider",
            !hasConflict 
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" 
              : "bg-red-500/10 border-red-500/20 text-red-400"
          )}>
            {!hasConflict ? "Verified" : "Conflict"}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Agent Visualization */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="ui-eyebrow text-[9px] text-white/40">Primary (Agent B)</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs font-semibold text-white/80">{primaryModel}</p>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
              <span className="ui-eyebrow text-[9px] text-white/40">Shadow (Agent C)</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <p className="text-xs font-semibold text-white/80">{shadowModel}</p>
            </div>
          </div>
        </div>

        {/* Status Messages */}
        <div className="space-y-2">
          {!hasConflict ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <p className="text-[11px] text-emerald-300/80">
                Independent shadow reasoning confirmed the primary decision. Policy alignment is verified across multiple neural networks.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-red-400">Decision Conflict Detected</p>
                {details.map((detail, idx) => (
                  <p key={idx} className="text-[10px] text-red-300/60 leading-relaxed">• {detail}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
