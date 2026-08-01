"use client";

/**
 * GraphTrace — Pre Auth Claim Event Trail + RAG Explainability
 * ==================================================================
 * Ported from claimaura/services/frontend/src/components/GraphTrace.tsx
 * Adapted for the existing Next.js design system (glass-card, brand tokens).
 *
 * Calls the graph service through a same-origin Next.js API route. The browser
 * must not call Docker-internal hostnames such as graph-service directly.
 */

import { useEffect, useState } from "react";
import { Activity, AlertCircle, Loader2 } from "lucide-react";

interface GraphNode {
  id: string;
  type: string;
  status?: string;
  event_type?: string;
  code?: string;
  display?: string;
  timestamp?: string;
  allowed?: boolean;
  denial_reasons?: string[];
  is_anomaly?: boolean;
  nhcx_ref?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  relation: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface QueryResult {
  claim_id: string;
  market_region: string;
  status: string;
  explanation: string;
  event_trail: string[];
  diagnoses: string[];
  providers: string[];
}

const GRAPH_BASE = "/api/graph";

async function fetchGraphPayload<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Graph service returned HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const EVENT_COLORS: Record<string, string> = {
  PREAUTH_REGISTERED: "#6366f1",
  FHIR_EXTRACTED: "#06b6d4",
  CONSENT_CHECKED: "#8b5cf6",
  RULES_EVALUATED: "#f59e0b",
  FWA_SCORED: "#ef4444",
  AUTO_APPROVED: "#10b981",
  HITL_ROUTED: "#f97316",
  HITL_DECIDED: "#84cc16",
  NHCX_SUBMITTED: "#06b6d4",
  SETTLEMENT_CALCULATED: "#10b981",
};

function eventColor(eventType: string): string {
  return EVENT_COLORS[eventType] ?? "#64748b";
}

function EventBadge({ type }: { type: string }) {
  const color = eventColor(type);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

export function GraphTrace({ claimId }: { claimId: string }) {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [query, setQuery] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!claimId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchGraphPayload<GraphData>(`${GRAPH_BASE}/graph/${claimId}`),
      fetchGraphPayload<QueryResult>(`${GRAPH_BASE}/query/${claimId}`),
    ])
      .then(([g, q]) => {
        if (cancelled) return;
        setGraph(g);
        setQuery(q);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? "Graph service unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [claimId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-white/40">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading claim event trail…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/8 px-4 py-3 text-sm text-amber-300">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Graph service unavailable — event trail will appear once the Pre Auth Claim
        lane is running.
      </div>
    );
  }

  if (!graph && !query) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-sm text-white/35">
        Claim registered — event trail will populate as the pre-authorization
        progresses through the Pre Auth Claim workflow.
      </div>
    );
  }

  const events = (graph?.nodes ?? [])
    .filter((n) => n.type === "Event")
    .sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

  const diagnoses = query?.diagnoses ?? [];
  const providers = query?.providers ?? [];

  return (
    <div className="space-y-5">
      {/* RAG Explanation */}
      {query?.explanation && (
        <div className="glass-card space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand-primary" />
            <span className="text-xs font-bold uppercase tracking-widest text-white/40">
              AI Explanation
            </span>
          </div>
          <p className="text-sm leading-relaxed text-white/75 italic">
            &ldquo;{query.explanation}&rdquo;
          </p>
          {(diagnoses.length > 0 || providers.length > 0) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {diagnoses.map((d) => (
                <span
                  key={d}
                  className="rounded-full border border-brand-primary/20 bg-brand-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-brand-primary"
                >
                  {d}
                </span>
              ))}
              {providers.map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-[11px] font-semibold text-white/55"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Event Trail */}
      {events.length > 0 && (
        <div className="glass-card p-5">
          <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/40">
            Event Trail
          </p>
          <ol className="relative space-y-4 border-l border-white/[0.08] pl-5">
            {events.map((event, idx) => (
              <li key={`${event.event_type}-${idx}`} className="relative">
                {/* Timeline dot */}
                <span
                  className="absolute -left-[1.35rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-[#0d0f12]"
                  style={{ background: eventColor(event.event_type ?? "") }}
                />
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <EventBadge type={event.event_type ?? "UNKNOWN"} />
                    {event.timestamp && (
                      <span className="font-mono text-[10px] text-white/30">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {/* Denial reasons */}
                  {event.denial_reasons && event.denial_reasons.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {event.denial_reasons.map((r, i) => (
                        <li key={i} className="text-xs text-red-300/80">
                          • {r}
                        </li>
                      ))}
                    </ul>
                  )}
                  {/* FWA anomaly */}
                  {event.is_anomaly && (
                    <p className="text-xs text-red-300/80">
                      ⚠ FWA anomaly detected — routed to manual review
                    </p>
                  )}
                  {/* NHCX ref */}
                  {event.nhcx_ref && (
                    <p className="font-mono text-[11px] text-white/40">
                      NHCX: {event.nhcx_ref}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Graph visualization — simple node list when no events yet */}
      {events.length === 0 && graph && (
        <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-sm text-white/35">
          Claim registered — event trail will populate as the pre-authorization
          progresses through the BPMN workflow.
        </div>
      )}
    </div>
  );
}
