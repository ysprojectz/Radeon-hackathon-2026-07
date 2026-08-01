"use client";
import { Check, Loader2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

export type StepState = "complete" | "active" | "waiting";

export interface ProcessingStep {
  label: string;
  description?: string;
  state: StepState;
}

interface ProcessingStepsProps {
  steps: ProcessingStep[];
  progress?: number; // 0-100
  className?: string;
}

export function ProcessingSteps({ steps, progress, className }: ProcessingStepsProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <ul className="space-y-3" aria-label="Processing steps">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-3" aria-current={step.state === "active" ? "step" : undefined}>
            <div className="mt-0.5 shrink-0">
              {step.state === "complete" ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500"
                  role="img"
                  aria-label={`${step.label}: completed`}
                >
                  <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />
                </span>
              ) : step.state === "active" ? (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-primary"
                  role="img"
                  aria-label={`${step.label}: in progress`}
                >
                  <Loader2 className="h-3.5 w-3.5 text-white animate-spin" aria-hidden="true" />
                </span>
              ) : (
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-muted-foreground/30"
                  role="img"
                  aria-label={`${step.label}: waiting`}
                >
                  <Circle className="h-3 w-3 text-muted-foreground/40" aria-hidden="true" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={cn(
                  "text-sm font-medium",
                  step.state === "complete"
                    ? "text-green-700 line-through decoration-green-400"
                    : step.state === "active"
                    ? "text-foreground"
                    : "text-muted-foreground"
                )}
              >
                {step.label}
              </p>
              {step.description && step.state === "active" && (
                <p className="text-xs text-muted-foreground">{step.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {progress !== undefined && (
        <div className="space-y-1.5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Processing progress: ${progress}%`}
          >
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-right" aria-hidden="true">{progress}%</p>
        </div>
      )}
    </div>
  );
}
