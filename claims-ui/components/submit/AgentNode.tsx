"use client";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type AgentState = "waiting" | "active" | "complete";

interface AgentNodeProps {
  icon: LucideIcon;
  label: string;
  state: AgentState;
}

export function AgentNode({ icon: Icon, label, state }: AgentNodeProps) {
  const labelLines = label.split("\n");

  return (
    <div
      className={cn(
        "relative flex min-h-[7.75rem] flex-col items-center justify-between rounded-2xl border px-3 py-3 text-center transition-colors",
        state === "complete" && "border-[var(--status-success)]/25 bg-[var(--status-success)]/[0.08]",
        state === "active" && "border-brand-primary/35 bg-brand-primary/[0.09] shadow-[var(--shadow)]",
        state === "waiting" && "border-[var(--border-subtle)] bg-[var(--acos-surface)]"
      )}
    >
      {state === "active" && (
        <motion.span
          className="absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-brand-primary to-transparent"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      <motion.div
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-2xl border transition-colors",
          state === "waiting" && "border-[var(--border-subtle)] bg-[var(--acos-surface)]",
          state === "active" && "border-brand-primary/45 bg-brand-primary/15 text-brand-primary",
          state === "complete" && "border-[var(--status-success)]/40 bg-[var(--status-success)]/90 text-dashboard-bg"
        )}
        animate={{
          scale: state === "active" ? [1, 1.04, 1] : state === "complete" ? [1.08, 1] : 1,
          boxShadow:
            state === "active"
              ? [
                  "0 2px 8px rgba(37,99,235,0.10)",
                  "0 4px 16px rgba(37,99,235,0.18)",
                  "0 2px 8px rgba(37,99,235,0.10)",
                ]
              : state === "complete"
                ? "0 0 18px rgba(52,211,153,0.22)"
                : "0 0 0 rgba(0,0,0,0)",
        }}
        transition={{
          scale: state === "active" ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" } : { type: "spring", stiffness: 300, damping: 20 },
          boxShadow: state === "active"
            ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.3 },
        }}
      >
        {state === "active" && (
          <motion.div
            className="absolute inset-[-4px] rounded-[1.15rem] border border-transparent border-t-brand-primary"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        )}

        <AnimatePresence mode="wait">
          {state === "complete" ? (
            <motion.div
              key="check"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 15 }}
            >
              <Check className="h-6 w-6" strokeWidth={3} />
            </motion.div>
          ) : (
            <motion.div
              key="icon"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <Icon
                className={cn(
                  "h-6 w-6",
                  state === "active" ? "text-brand-primary" : "text-text-muted"
                )}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="min-h-8">
        <p
          className={cn(
            "text-[11px] font-bold leading-tight",
            state === "active" && "text-brand-primary",
            state === "complete" && "text-[var(--status-success)]",
            state === "waiting" && "text-text-muted"
          )}
        >
          {labelLines.map((line) => (
            <span key={line} className="block">{line}</span>
          ))}
        </p>
      </div>

      <span
        className={cn(
          "h-1.5 w-8 rounded-full",
          state === "active" && "bg-brand-primary shadow-[var(--shadow)]",
          state === "complete" && "bg-[var(--status-success)]",
          state === "waiting" && "bg-[var(--acos-surface-strong)]"
        )}
      />
    </div>
  );
}
