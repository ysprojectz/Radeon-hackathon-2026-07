"use client";
import { useState } from "react";
import { CheckCircle, XCircle, Globe, Building2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PolicyCitation } from "@/lib/types";

interface PolicyCitationsPanelProps {
  citations: PolicyCitation[];
  fromRulesEngine?: boolean;
}

export function PolicyCitationsPanel({ citations, fromRulesEngine = false }: PolicyCitationsPanelProps) {
  const [activeTab, setActiveTab] = useState<"all" | "REGIONAL" | "COMPANY">("all");

  const regional = citations.filter((c) => c.tier === "REGIONAL");
  const company  = citations.filter((c) => c.tier === "COMPANY" || !c.tier);
  const filtered = activeTab === "all" ? citations : activeTab === "REGIONAL" ? regional : company;

  const otherCount = activeTab === "REGIONAL" ? company.length : activeTab === "COMPANY" ? regional.length : 0;
  const otherLabel = activeTab === "REGIONAL" ? "Company" : "Regional";

  return (
    <div className="space-y-4">
      {/* Rules-engine fallback banner */}
      {fromRulesEngine && citations.length > 0 && (
        <div className="glass-card flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-amber-300">AI analysis unavailable for this claim</p>
            <p className="text-[11px] text-amber-300/60 mt-0.5">
              Showing rules-based citations. Re-submit or re-adjudicate this claim after an AI assistant provider is configured to get full policy citations.
            </p>
          </div>
        </div>
      )}

      {/* Zero citations at all */}
      {citations.length === 0 && (
        <div className="glass-card flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-4">
          <AlertCircle className="h-4 w-4 text-white/25 mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-white/45">No policy citations available</p>
            <p className="text-[11px] text-white/30 mt-0.5">
              This claim had no line items with denial reasons or clause references to derive citations from.
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs — only show when there are citations */}
      {citations.length > 0 && (
        <div className="flex items-center gap-1.5">
          {([
            { id: "all",      label: `All (${citations.length})`,     icon: null },
            { id: "REGIONAL", label: `Regional (${regional.length})`, icon: <Globe className="h-3 w-3" /> },
            { id: "COMPANY",  label: `Company (${company.length})`,   icon: <Building2 className="h-3 w-3" /> },
          ] as const).map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-all",
                activeTab === id
                  ? "bg-brand-primary/15 border-brand-primary/30 text-brand-primary"
                  : "bg-white/[0.03] border-white/[0.07] text-white/45 hover:bg-white/[0.06] hover:text-white/70"
              )}
            >
              {icon}{label}
            </button>
          ))}
        </div>
      )}

      {/* Cards or per-tab empty state */}
      {citations.length > 0 && (
        filtered.length === 0 ? (
          <div className="glass-card flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <Globe className="h-4 w-4 text-white/20 mt-0.5 shrink-0" />
            <p className="text-[12px] text-white/40">
              No {activeTab === "REGIONAL" ? "regional / regulatory" : "company policy"} citations for this claim.
              {otherCount > 0 && (
                <> Switch to <button onClick={() => setActiveTab(activeTab === "REGIONAL" ? "COMPANY" : "REGIONAL")} className="text-brand-primary hover:underline ml-1">{otherLabel} ({otherCount})</button> to see available citations.</>
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((c, i) => <CitationCard key={i} citation={c} />)}
          </div>
        )
      )}
    </div>
  );
}

function CitationCard({ citation: c }: { citation: PolicyCitation }) {
  const isRegional   = c.tier === "REGIONAL";
  const relevance    = c.relevance_score ?? 0;
  const relevancePct = relevance <= 1 ? relevance * 100 : relevance;

  return (
    <div className="glass-card rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3 transition-colors hover:bg-white/[0.05]">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isRegional
              ? "border-blue-500/25 bg-blue-500/10 text-blue-400"
              : "border-violet-500/25 bg-violet-500/10 text-violet-400"
          )}>
            {isRegional ? <Globe className="h-2.5 w-2.5" /> : <Building2 className="h-2.5 w-2.5" />}
            {c.tier ?? "COMPANY"}
          </span>
          <span className="font-mono text-[11px] text-white/45">
            {c.clause_id ?? c.clause_reference ?? "—"}
          </span>
        </div>
        {c.status && (
          <span className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold shrink-0",
            c.status === "COMPLIANT" || c.status === "COVERED"
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/25 bg-red-500/10 text-red-400"
          )}>
            {c.status === "COMPLIANT" || c.status === "COVERED"
              ? <CheckCircle className="h-2.5 w-2.5" />
              : <XCircle className="h-2.5 w-2.5" />}
            {c.status}
          </span>
        )}
      </div>

      {/* Clause text */}
      {c.clause_text && (
        <blockquote className="border-l-2 border-brand-primary/30 pl-3 text-[12px] text-white/55 italic leading-relaxed">
          &ldquo;{c.clause_text}&rdquo;
        </blockquote>
      )}

      {c.source && (
        <p className="text-[11px] text-white/35">Source: {c.source}</p>
      )}

      {/* Relevance bar */}
      {c.relevance_score !== undefined && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/40 w-16 shrink-0">Relevance</span>
          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden max-w-40">
            <div
              className="h-full bg-brand-primary rounded-full transition-all"
              style={{ width: `${relevancePct}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-white/45 w-8 text-right">{relevance.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
