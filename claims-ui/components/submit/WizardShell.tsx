"use client";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { ReactNode } from "react";

const STEPS = [
  { label: "Submit Claim" },
  { label: "Review Document" },
  { label: "Processing" },
  { label: "Result" },
];

interface WizardShellProps {
  step: 1 | 2 | 3 | 4;
  children: ReactNode;
}

export function WizardShell({ step, children }: WizardShellProps) {
  return (
    <div className="mx-auto max-w-6xl space-y-12">
      {/* Step indicator */}
      <div className="flex items-center justify-between max-w-2xl mx-auto pt-4 px-5 sm:px-2">
        {STEPS.map((s, i) => {
          const num = i + 1;
          const done = num < step;
          const active = num === step;
          return (
            <div key={i} className="flex flex-1 items-center last:flex-none">
              {/* Circle */}
              <div className="flex flex-col items-center gap-2 relative">
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: done ? "#2563EB" : "transparent",
                    borderColor: done || active ? "#2563EB" : "var(--border-strong)",
                    scale: active ? 1.1 : 1,
                  }}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold border-2 transition-all duration-300",
                    done
                      ? "text-white shadow-[var(--shadow-sm)]"
                      : active
                      ? "text-brand-primary shadow-[var(--shadow-sm)]"
                      : "text-text-muted"
                  )}
                >
                  {done ? (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <Check className="h-4 w-4" />
                    </motion.div>
                  ) : num}
                </motion.div>
                <span
                  className={cn(
                    "absolute top-11 whitespace-nowrap text-[10px] uppercase tracking-widest transition-colors duration-300",
                    active
                      ? "text-brand-primary font-bold"
                      : "text-text-muted"
                  )}
                >
                  {s.label}
                </span>
              </div>
              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-4 h-px relative">
                  <div className="absolute inset-0 bg-[var(--border-subtle)]" />
                  <motion.div
                    initial={{ width: "0%" }}
                    animate={{ width: done ? "100%" : "0%" }}
                    className="absolute inset-0 bg-brand-primary"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Content Area */}
      <div className="relative min-h-[500px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            <div className="glass-card rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden p-8 cinematicPageIn">
              {children}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
