"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, AlertTriangle, X, PauseCircle, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import type { ProactiveAlert } from "@/lib/hooks/useProactiveIntelligence";

interface NeuralIntelligenceTickerProps {
  alerts: ProactiveAlert[];
  onDismiss: (id: string) => void;
}

export function NeuralIntelligenceTicker({ alerts, onDismiss }: NeuralIntelligenceTickerProps) {
  const [isPaused, setIsPaused] = useState(false);

  if (alerts.length === 0) return null;

  const criticalAlerts = alerts.filter(a => a.severity === "critical");
  const displayAlerts = criticalAlerts.length > 0 ? criticalAlerts : alerts.slice(0, 3);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 mt-2 mb-6">
      <Card variant="surface" className="relative overflow-hidden rounded-[2rem] border-white/[0.08] bg-black/40 p-0 backdrop-blur-xl">
        {/* Animated background pulse */}
        {!isPaused && (
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/5 via-transparent to-red-500/5 animate-pulse" />
        )}

        {/* Freeze/Unfreeze controls */}
        <div className="absolute top-3 right-3 flex items-center gap-1">
          <button
            onClick={() => setIsPaused(!isPaused)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-xl text-white/30 transition-all hover:bg-white/5 hover:text-white",
              isPaused ? "text-white bg-white/10" : ""
            )}
            title={isPaused ? "Unfreeze intelligence feed" : "Freeze intelligence feed"}
          >
            {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
          </button>
        </div>
        
        <div className="relative flex flex-col divide-y divide-white/[0.06]">
          <AnimatePresence mode="popLayout">
            {displayAlerts.map((alert) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: -10 }}
                animate={isPaused ? { opacity: 1, y: -10 } : { opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: isPaused ? 0 : 0.3 }}
                className="group flex items-center gap-4 p-4 transition-colors hover:bg-white/[0.02]"
              >
                <div className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                  alert.severity === "critical" 
                    ? "border-red-500/20 bg-red-500/10 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]" 
                    : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                )}>
                  {alert.severity === "critical" ? <AlertCircle size={20} /> : <AlertTriangle size={20} />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-[0.2em]",
                      alert.severity === "critical" ? "text-red-500" : "text-amber-500"
                    )}>
                      {alert.category.replace("_", " ")}
                    </span>
                    <span className="h-1 w-1 rounded-full bg-white/20" />
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                      Detected {new Date(alert.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <h4 className="mt-0.5 text-[14px] font-black text-white/90 truncate">
                    {alert.title}
                  </h4>
                  <p className="text-[12px] font-medium text-white/50 line-clamp-1">
                    {alert.body}
                  </p>
                </div>

                <div className="flex items-center gap-2 px-2">
                  <button
                    onClick={() => onDismiss(alert.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-white/20 transition-all hover:bg-white/5 hover:text-white"
                    title="Dismiss alert"
                  >
                    <X size={16} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {alerts.length > displayAlerts.length && (
          <div className="bg-white/[0.03] px-6 py-2">
            <p className="text-[10px] font-bold text-white/25 uppercase tracking-[0.1em]">
              + {alerts.length - displayAlerts.length} more intelligence signals active
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
