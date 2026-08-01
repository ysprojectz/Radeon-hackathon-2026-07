"use client";
import { motion } from "framer-motion";
import { Check, Shield, Brain, FileText, Calculator, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineStage = "OCR" | "RULES" | "AI" | "SETTLEMENT" | "AUDIT";

interface StageProps {
  id: PipelineStage;
  label: string;
  status: "pending" | "active" | "completed" | "failed";
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const STAGES: StageProps[] = [
  {
    id: "OCR",
    label: "Document Extraction",
    status: "pending",
    icon: FileText,
  },
  { id: "RULES", label: "Policy Rules Engine", status: "pending", icon: Shield },
  { id: "AI", label: "Neural Reasoning", status: "pending", icon: Brain },
  { id: "SETTLEMENT", label: "Financial Calculation", status: "pending", icon: Calculator },
  { id: "AUDIT", label: "Blockchain Audit", status: "pending", icon: Activity },
];

export function NeuralPipelineTracker({ currentStage, failedStage }: { currentStage: PipelineStage, failedStage?: PipelineStage }) {
  return (
    <div className="w-full max-w-4xl mx-auto p-8 rounded-2xl bg-[var(--bg-card-muted)] border border-[var(--border-subtle)] backdrop-blur-xl">
      <div className="flex justify-between items-start relative">
        {/* Progress Line */}
        <div className="absolute top-6 left-0 right-0 h-[2px] bg-[var(--acos-surface)] z-0" />
        
        {STAGES.map((stage, idx) => {
          const isCompleted = STAGES.findIndex(s => s.id === currentStage) > idx;
          const isActive = stage.id === currentStage;
          const isFailed = stage.id === failedStage;
          
          return (
            <div key={stage.id} className="flex flex-col items-center z-10 w-1/5">
              <motion.div
                initial={false}
                animate={{
                  scale: isActive ? 1.2 : 1,
                  backgroundColor: isCompleted ? "#22c55e" : isActive ? "#06b6d4" : isFailed ? "#ef4444" : "#1f1f23",
                  borderColor: isActive ? "#06b6d4" : "rgba(255,255,255,0.1)",
                }}
                className={cn(
                  "w-12 h-12 rounded-full border-2 flex items-center justify-center transition-shadow shadow-2xl",
                  isActive && "shadow-[var(--shadow)]",
                  isCompleted && "shadow-[var(--shadow-sm)]"
                )}
              >
                {isCompleted ? (
                  <Check className="text-text-primary" size={20} />
                ) : isActive ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  >
                    <stage.icon className="text-text-primary" size={20} />
                  </motion.div>
                ) : isFailed ? (
                  <div className="text-text-primary font-bold">!</div>
                ) : (
                  <stage.icon className="text-text-muted" size={20} />
                )}
              </motion.div>
              
              <div className="mt-4 text-center">
                <p className={cn(
                  "ui-eyebrow text-[10px] tracking-widest transition-colors",
                  isActive ? "text-brand-primary" : isCompleted ? "text-[var(--status-success)]" : "text-text-muted"
                )}>
                  {stage.label}
                </p>
                {isActive && (
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-[9px] text-brand-primary/60 mt-1 animate-pulse"
                  >
                    Processing...
                  </motion.p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Neural Background Pulse */}
      <div className="mt-12 h-1 w-full bg-[var(--acos-surface)] rounded-full overflow-hidden">
        <motion.div
          animate={{
            x: ["-100%", "100%"],
          }}
          transition={{
            repeat: Infinity,
            duration: 3,
            ease: "linear",
          }}
          className="h-full w-1/3 bg-gradient-to-r from-transparent via-brand-primary to-transparent"
        />
      </div>
    </div>
  );
}
