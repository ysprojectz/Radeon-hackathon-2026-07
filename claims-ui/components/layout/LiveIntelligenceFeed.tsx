"use client";

import { motion, AnimatePresence } from "motion/react";
import { Zap, AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProactiveAlert } from "@/lib/hooks/useProactiveIntelligence";

interface LiveIntelligenceFeedProps {
  alerts: ProactiveAlert[];
  isOpen: boolean;
}

export function LiveIntelligenceFeed({ alerts, isOpen }: LiveIntelligenceFeedProps) {
  if (alerts.length === 0) return null;

  // Show only top 2 alerts in the feed
  const displayAlerts = alerts.slice(0, 2);

  return (
    <div className={cn(
      "px-4 py-2 mt-2 mb-4 transition-all duration-500",
      isOpen ? "opacity-100" : "opacity-0 pointer-events-none h-0 overflow-hidden"
    )}>
      <div className="flex items-center gap-2 mb-3 px-2">
        <div className="relative">
          <Zap size={12} className="text-brand-primary fill-brand-primary" />
          <div className="absolute inset-0 bg-brand-primary/40 blur-sm animate-pulse rounded-full" />
        </div>
        <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">
          Intelligence Feed
        </span>
      </div>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {displayAlerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={cn(
                "group relative overflow-hidden rounded-xl border p-2.5 transition-all hover:bg-white/[0.04]",
                alert.severity === "critical" 
                  ? "border-red-500/10 bg-red-500/5" 
                  : "border-white/[0.05] bg-white/[0.02]"
              )}
            >
              <div className="flex items-start gap-2.5">
                <div className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border",
                  alert.severity === "critical" 
                    ? "border-red-500/20 bg-red-500/10 text-red-400" 
                    : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                )}>
                  {alert.severity === "critical" ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    "text-[11px] font-bold leading-tight line-clamp-2",
                    alert.severity === "critical" ? "text-red-200" : "text-white/80"
                  )}>
                    {alert.title}
                  </p>
                  <p className="mt-1 text-[9px] font-medium text-white/30 truncate">
                    {new Date(alert.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {alerts.length > 2 && (
        <button className="w-full mt-2 text-center py-1 rounded-lg hover:bg-white/5 transition-colors">
          <span className="text-[9px] font-black text-white/20 uppercase tracking-widest">
            + {alerts.length - 2} more signals
          </span>
        </button>
      )}
    </div>
  );
}
