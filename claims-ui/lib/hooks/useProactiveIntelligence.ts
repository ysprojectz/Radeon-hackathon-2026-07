"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { getHealth } from "@/lib/api";
import type { DashboardKPIs, HITLQueueResponse } from "@/lib/types";

export type AlertSeverity = "critical" | "warning" | "info";
export type AlertCategory =
  | "hitl_overdue"
  | "hitl_backlog"
  | "sla_breach"
  | "denial_spike"
  | "api_down"
  | "db_down"
  | "pipeline_failure"
  | "dead_letters"
  | "auto_adjud_drop"
  | "compliance_drift";

export interface ProactiveAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  body: string;
  prompt: string;
  followUps: string[];
  detectedAt: Date;
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function deriveAlerts(
  kpis: DashboardKPIs | undefined,
  hitl: HITLQueueResponse | undefined,
  apiHealthy: boolean
): ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];

  // ── API / Infrastructure ─────────────────────────────────────────────────
  if (!apiHealthy) {
    alerts.push({
      id: "api_down",
      severity: "critical",
      category: "api_down",
      title: "API gateway unreachable",
      body: "Cannot reach the claims API. New submissions and adjudications are blocked.",
      prompt: "The API gateway appears to be down. What should I check first and what's the recovery plan?",
      followUps: ["Check system health", "View pipeline status", "Review recent failures", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  if (kpis?.db_available === false) {
    alerts.push({
      id: "db_down",
      severity: "critical",
      category: "db_down",
      title: "Database connection lost",
      body: "PostgreSQL is disconnected. Claim persistence and audit trail are unavailable.",
      prompt: "The database is disconnected. What impact does this have on in-flight claims and how do we recover?",
      followUps: ["System health check", "Check affected claims", "Recovery steps", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  // ── HITL backlog ─────────────────────────────────────────────────────────
  const pendingHitl = kpis?.pending_hitl_count ?? 0;
  const overdueCount = kpis?.overdue_hitl_count ?? 0;
  if (overdueCount === 0 && pendingHitl > 15) {
    alerts.push({
      id: "hitl_backlog",
      severity: "warning",
      category: "hitl_backlog",
      title: `${pendingHitl} claims awaiting review`,
      body: `The HITL review queue has ${pendingHitl} pending claims. Capacity may be constrained.`,
      prompt: `There are ${pendingHitl} claims in the review queue. Summarize the workload and recommend how to clear it efficiently.`,
      followUps: ["Queue breakdown", "Prioritize by risk", "Assign workload", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  // ── Denial rate spike ────────────────────────────────────────────────────
  const denialRate = kpis?.denial_rate ?? 0;
  if (denialRate > 25) {
    alerts.push({
      id: "denial_spike_critical",
      severity: "critical",
      category: "denial_spike",
      title: `Denial rate at ${denialRate.toFixed(1)}%`,
      body: `Denial rate has spiked above 25%. This may indicate a rules engine issue or a data quality problem.`,
      prompt: `The denial rate has spiked to ${denialRate.toFixed(1)}%. What are the top denial reasons and is this a systemic issue or a rules engine problem?`,
      followUps: ["Top denial reasons", "Compare to baseline", "Rules engine check", "✏ Write my own"],
      detectedAt: new Date(),
    });
  } else if (denialRate > 15) {
    alerts.push({
      id: "denial_spike_warn",
      severity: "warning",
      category: "denial_spike",
      title: `Denial rate elevated — ${denialRate.toFixed(1)}%`,
      body: `Denial rate is above normal. Check for policy rule changes or data quality issues.`,
      prompt: `Denial rate is at ${denialRate.toFixed(1)}%. What are the top drivers and should I be concerned?`,
      followUps: ["Denial breakdown", "Policy rule changes", "Generate denial report", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  // ── Auto-adjudication drop ───────────────────────────────────────────────
  const autoRate = kpis?.auto_adjudication_rate ?? 100;
  if (autoRate < 40) {
    alerts.push({
      id: "auto_adjud_drop",
      severity: "warning",
      category: "auto_adjud_drop",
      title: `Auto-adjudication at ${autoRate.toFixed(0)}%`,
      body: `Automated processing rate is below 40%. More claims require manual intervention than expected.`,
      prompt: `Auto-adjudication rate dropped to ${autoRate.toFixed(0)}%. What's causing claims to fall through to manual review?`,
      followUps: ["Confidence threshold review", "Low-confidence claims", "AI model status", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  // ── Compliance drift ─────────────────────────────────────────────────────
  const drift = kpis?.compliance_drift ?? {};
  const driftViolations = Object.entries(drift).filter(([, v]) => v === true);
  if (driftViolations.length > 0) {
    alerts.push({
      id: "compliance_drift",
      severity: "warning",
      category: "compliance_drift",
      title: `${driftViolations.length} compliance drift signal${driftViolations.length > 1 ? "s" : ""}`,
      body: `Compliance checks flagged: ${driftViolations.map(([k]) => k).join(", ")}.`,
      prompt: `Compliance drift detected in: ${driftViolations.map(([k]) => k).join(", ")}. What are the regulatory implications and what actions are needed?`,
      followUps: ["Compliance breakdown", "Regulatory impact", "Audit trail", "✏ Write my own"],
      detectedAt: new Date(),
    });
  }

  return alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function useProactiveIntelligence(
  kpis: DashboardKPIs | undefined,
  hitl: HITLQueueResponse | undefined
) {
  const [alerts, setAlerts] = useState<ProactiveAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [apiHealthy, setApiHealthy] = useState(true);
  const healthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll API health every 30s
  useEffect(() => {
    async function checkHealth() {
      try {
        await getHealth();
        setApiHealthy(true);
      } catch {
        setApiHealthy(false);
      }
    }
    checkHealth();
    healthPollRef.current = setInterval(checkHealth, 30_000);
    return () => { if (healthPollRef.current) clearInterval(healthPollRef.current); };
  }, []);

  // Re-derive alerts whenever data changes
  useEffect(() => {
    const derived = deriveAlerts(kpis, hitl, apiHealthy);
    setAlerts(derived);
  }, [kpis, hitl, apiHealthy]);

  const dismiss = useCallback((id: string) => {
    setDismissed(prev => new Set([...prev, id]));
  }, []);

  const dismissAll = useCallback(() => {
    setDismissed(new Set(alerts.map(a => a.id)));
  }, [alerts]);

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id));
  const criticalCount = visibleAlerts.filter(a => a.severity === "critical").length;
  const warningCount  = visibleAlerts.filter(a => a.severity === "warning").length;
  const totalUnread   = visibleAlerts.length;

  return { visibleAlerts, criticalCount, warningCount, totalUnread, dismiss, dismissAll };
}
