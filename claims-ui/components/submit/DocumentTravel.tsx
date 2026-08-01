"use client";
import { motion } from "motion/react";
import { FileText } from "lucide-react";

type StepId = "ocr" | "eligibility" | "ai" | "settlement";

interface DocumentTravelProps {
  currentStep: StepId;
  /** Center X positions of each agent node (relative to container) */
  nodePositions: Record<StepId, number>;
}

const STEP_ORDER: StepId[] = ["ocr", "eligibility", "ai", "settlement"];

export function DocumentTravel({ currentStep, nodePositions }: DocumentTravelProps) {
  const targetX = nodePositions[currentStep];
  const stepIdx = STEP_ORDER.indexOf(currentStep);

  return (
    <>
      <motion.div
        className="pointer-events-none absolute top-1/2 z-10"
        animate={{
          left: `${targetX}%`,
          x: "-50%",
          y: "-50%",
          rotate: [0, -3, 3, 0],
        }}
        transition={{
          left: { type: "spring", stiffness: 100, damping: 18 },
          y: { type: "spring", stiffness: 120, damping: 18 },
          rotate: { duration: 0.7, ease: "easeInOut" },
        }}
      >
        <motion.div
          className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-primary/35 bg-[var(--bg-card)] shadow-[var(--shadow-md)]"
          animate={{ scale: [1, 1.12, 1] }}
          transition={{ duration: 0.55, delay: 0.15 }}
          key={currentStep}
        >
          <motion.span
            className="absolute inset-x-2 top-2 h-px bg-brand-primary/70"
            animate={{ y: [0, 18, 0], opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
          />
          <FileText className="h-5 w-5 text-brand-primary" />
        </motion.div>
      </motion.div>

      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={`particle-${i}`}
          className="pointer-events-none absolute top-1/2 z-[9]"
          animate={{
            left: `${targetX}%`,
            x: `${-22 - i * 10}px`,
            y: `${-2 + (i % 2) * 5}px`,
            opacity: [0, 0.55 - i * 0.1, 0],
          }}
          transition={{
            left: { type: "spring", stiffness: 100, damping: 18, delay: i * 0.05 },
            x: { duration: 0.6, delay: i * 0.05 },
            y: { duration: 0.6, delay: i * 0.05 },
            opacity: { duration: 0.9, delay: i * 0.05 },
          }}
        >
          <div
            className="rounded-full bg-brand-primary/65"
            style={{ width: 6 - i, height: 6 - i }}
          />
        </motion.div>
      ))}

      <motion.div
        className="pointer-events-none absolute top-1/2 h-px bg-gradient-to-r from-transparent via-brand-primary/60 to-transparent"
        animate={{
          left: `${Math.max(6, targetX - 17)}%`,
          width: `${stepIdx === 0 ? 12 : 22}%`,
          opacity: [0.25, 0.85, 0.25],
        }}
        transition={{
          left: { type: "spring", stiffness: 90, damping: 20 },
          width: { duration: 0.4 },
          opacity: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
        }}
      />
    </>
  );
}
