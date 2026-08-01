"use client";
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Brain, Calculator, FileSearch, ScanLine, ShieldCheck } from "lucide-react";
import { AgentNode, type AgentState } from "./AgentNode";
import { DocumentTravel } from "./DocumentTravel";
import { cn } from "@/lib/utils";

type StepId = "ocr" | "eligibility" | "ai" | "settlement";

interface ClaimProcessingOverlayProps {
  currentStep: StepId;
  progress: number;
}

const STEP_ORDER: StepId[] = ["ocr", "eligibility", "ai", "settlement"];

const AGENTS = [
  { id: "ocr" as const, icon: ScanLine, label: "Document\nIntake", shortLabel: "Intake" },
  { id: "eligibility" as const, icon: ShieldCheck, label: "Coverage\nCheck", shortLabel: "Coverage" },
  { id: "ai" as const, icon: Brain, label: "Policy\nReview", shortLabel: "Review" },
  { id: "settlement" as const, icon: Calculator, label: "Benefit\nSettlement", shortLabel: "Settlement" },
];

const STATUS_MESSAGES: Record<StepId, { title: string; subtitles: string[] }> = {
  ocr: {
    title: "Validating Document",
    subtitles: [
      "Verifying document authenticity and structure…",
      "Reading claim details from the uploaded document…",
      "Extracting patient and service information…",
    ],
  },
  eligibility: {
    title: "Verifying Coverage",
    subtitles: [
      "Checking policy coverage and active status…",
      "Validating member eligibility and benefits…",
      "Confirming network provider and service dates…",
    ],
  },
  ai: {
    title: "Policy Review Running",
    subtitles: [
      "Rules and policy review are cross-checking coverage…",
      "Referencing policy clauses and regulatory mandates…",
      "Independent validators are reviewing coverage decisions…",
    ],
  },
  settlement: {
    title: "Calculating Benefits",
    subtitles: [
      "Computing settlement amounts and deductions…",
      "Applying co-pays, deductibles, and sub-limits…",
      "Finalizing plan payment and member responsibility…",
    ],
  },
};

const NODE_X: Record<StepId, number> = {
  ocr: 12.5,
  eligibility: 37.5,
  ai: 62.5,
  settlement: 87.5,
};

function getStepState(step: StepId, currentStep: StepId): AgentState {
  const currentIdx = STEP_ORDER.indexOf(currentStep);
  const stepIdx = STEP_ORDER.indexOf(step);
  if (stepIdx < currentIdx) return "complete";
  if (stepIdx === currentIdx) return "active";
  return "waiting";
}

export function ClaimProcessingOverlay({ currentStep, progress }: ClaimProcessingOverlayProps) {
  const msg = STATUS_MESSAGES[currentStep];
  const [subtitleIndex, setSubtitleIndex] = useState(0);
  const activeIndex = STEP_ORDER.indexOf(currentStep);
  const activeAgent = AGENTS[activeIndex];
  const ActiveIcon = activeAgent.icon;
  const safeProgress = Math.max(0, Math.min(100, progress));

  // Rotate through subtitles every 2 seconds
  useEffect(() => {
    setSubtitleIndex(0); // Reset when step changes
    const interval = setInterval(() => {
      setSubtitleIndex((prev) => (prev + 1) % msg.subtitles.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [currentStep, msg.subtitles.length]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="absolute inset-0 bg-dashboard-bg/88 backdrop-blur-2xl" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:42px_42px] opacity-35" />

      <motion.div
        className="glass-card relative z-10 w-full max-w-4xl overflow-hidden rounded-[1.75rem] border-[var(--border-subtle)] bg-[#08090b]/96 shadow-[0_28px_90px_rgba(0,0,0,0.55)]"
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 1.02, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-primary/70 to-transparent" />

        <div className="grid gap-5 px-5 pb-5 pt-5 sm:px-7 sm:pb-7 sm:pt-6 lg:grid-cols-[1fr_17rem]">
          <div className="min-w-0">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-brand-primary/18 bg-brand-primary/[0.08] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-brand-primary/85">
                  <Activity className="h-3 w-3" />
                  Live adjudication
                </div>
                <h2 className="mt-3 text-xl font-black tracking-normal text-text-primary sm:text-2xl">
                  Processing Your Claim
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-primary opacity-45" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-primary" />
                </span>
                <span className="font-mono text-xs font-semibold text-text-secondary">{safeProgress}%</span>
              </div>
            </div>

            <div className="relative mt-6 overflow-hidden rounded-3xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-5 sm:px-5">
              <motion.div
                className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-brand-primary/[0.07] to-transparent"
                animate={{ x: ["-35%", "780%"] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              />

              <div className="relative hidden h-14 sm:block">
                <div className="absolute inset-x-[6%] top-1/2 h-px -translate-y-1/2 bg-[var(--acos-surface-strong)]" />
                <motion.div
                  className="absolute left-[6%] top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-[var(--status-success)] via-brand-primary to-brand-primary/20"
                  initial={{ width: "0%" }}
                  animate={{ width: `${Math.min(88, Math.max(0, activeIndex * 25 + 12))}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                />
                <DocumentTravel currentStep={currentStep} nodePositions={NODE_X} />
              </div>

              <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-4">
                {AGENTS.map((agent) => (
                  <AgentNode
                    key={agent.id}
                    icon={agent.icon}
                    label={agent.label}
                    state={getStepState(agent.id, currentStep)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
              <div className="flex gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-primary/25 bg-brand-primary/10 text-brand-primary">
                  <ActiveIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <motion.p
                    className="text-sm font-bold text-brand-primary"
                    key={currentStep}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    {msg.title}
                  </motion.p>
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={`${currentStep}-${subtitleIndex}`}
                      className="mt-1 text-xs leading-5 text-text-muted"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.3 }}
                    >
                      {msg.subtitles[subtitleIndex]}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] text-brand-primary">
                <FileSearch className="h-5 w-5" />
              </div>
              <div>
                <p className="ui-eyebrow text-text-muted">Active agent</p>
                <p className="text-sm font-bold text-text-primary">{activeAgent.shortLabel}</p>
              </div>
            </div>

            <div className="space-y-2">
              {AGENTS.map((agent, index) => {
                const state = getStepState(agent.id, currentStep);
                return (
                  <div
                    key={agent.id}
                    className={cn(
                      "flex items-center justify-between rounded-2xl border px-3 py-2 transition-colors",
                      state === "complete" && "border-[var(--status-success)]/18 bg-[var(--status-success)]/[0.06]",
                      state === "active" && "border-brand-primary/25 bg-brand-primary/[0.08]",
                      state === "waiting" && "border-[var(--border-subtle)] bg-[var(--acos-surface)]"
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-black",
                        state === "complete" && "bg-[var(--status-success)]/15 text-[var(--status-success)]",
                        state === "active" && "bg-brand-primary/15 text-brand-primary",
                        state === "waiting" && "bg-[var(--acos-surface-strong)] text-text-muted"
                      )}>
                        {index + 1}
                      </span>
                      <span className="truncate text-xs font-semibold text-text-secondary">{agent.shortLabel}</span>
                    </div>
                    <span className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      state === "complete" && "bg-[var(--status-success)]",
                      state === "active" && "bg-brand-primary shadow-[var(--shadow)]",
                      state === "waiting" && "bg-[var(--acos-surface)]"
                    )} />
                  </div>
                );
              })}
            </div>

            <div className="mt-auto rounded-2xl border border-[var(--border-subtle)] bg-[#050607] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="ui-eyebrow text-text-muted">Journey progress</span>
                <motion.span
                  className="font-mono text-xs font-bold text-brand-primary"
                  key={safeProgress}
                  initial={{ scale: 1.16 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.2 }}
                >
                  {safeProgress}%
                </motion.span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--acos-surface-strong)]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-brand-primary via-[var(--status-success)] to-brand-primary"
                  initial={{ width: "0%" }}
                  animate={{ width: `${safeProgress}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          </aside>
        </div>
      </motion.div>
    </motion.div>
  );
}
