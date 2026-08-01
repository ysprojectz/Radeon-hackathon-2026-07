"use client";

import { useEffect, useState } from "react";
import { parseISO, differenceInMinutes, isPast } from "date-fns";
import { cn } from "@/lib/utils";

interface SLACountdownProps {
  slaDeadline: string; // ISO string
  className?: string;
}

// Global tick that updates every minute at :00 seconds
// This ensures all countdowns update simultaneously
let globalTickListeners: Array<() => void> = [];
let globalTickInterval: NodeJS.Timeout | null = null;

function subscribeToGlobalTick(callback: () => void) {
  globalTickListeners.push(callback);

  // Start global interval if not running
  if (!globalTickInterval) {
    // Calculate ms until next minute boundary
    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    // Wait until next minute, then start interval
    setTimeout(() => {
      // Fire immediately at minute boundary
      globalTickListeners.forEach(cb => cb());

      // Then every 60 seconds
      globalTickInterval = setInterval(() => {
        globalTickListeners.forEach(cb => cb());
      }, 60000);
    }, msUntilNextMinute);
  }

  return () => {
    globalTickListeners = globalTickListeners.filter(cb => cb !== callback);
    if (globalTickListeners.length === 0 && globalTickInterval) {
      clearInterval(globalTickInterval);
      globalTickInterval = null;
    }
  };
}

/**
 * Ring gauge SLA countdown with time remaining until deadline.
 * Ring stroke color transitions: green (>2h) → amber (<2h) → red (overdue)
 * Pulse animation doubles in speed when <2h remaining.
 * Font-mono for time display inside ring.
 */
export function SLACountdown({ slaDeadline, className }: SLACountdownProps) {
  const [displayText, setDisplayText] = useState<string>("");
  const [minutesLeft, setMinutesLeft] = useState<number>(0);

  useEffect(() => {
    const calculateTimeRemaining = () => {
      try {
        const deadline = parseISO(slaDeadline);
        const now = new Date();

        // Check if overdue
        if (isPast(deadline)) {
          setDisplayText("0m");
          setMinutesLeft(0);
          return;
        }

        // Calculate minutes remaining
        const mins = differenceInMinutes(deadline, now);
        setMinutesLeft(mins);

        const hoursLeft = Math.floor(mins / 60);
        const remainingMins = mins % 60;

        // Format time string
        let formatted = "";
        if (hoursLeft > 0) {
          formatted = `${hoursLeft}h ${remainingMins}m`;
        } else {
          formatted = `${remainingMins}m`;
        }

        setDisplayText(formatted);
      } catch (error) {
        console.error("SLACountdown: Invalid deadline format", error);
        setDisplayText("--");
        setMinutesLeft(0);
      }
    };

    // Initial calculation
    calculateTimeRemaining();

    // Subscribe to synchronized global tick
    const unsubscribe = subscribeToGlobalTick(calculateTimeRemaining);

    // Cleanup on unmount
    return unsubscribe;
  }, [slaDeadline]);

  // Determine color based on time remaining
  const getStrokeColor = () => {
    if (minutesLeft === 0) return "#ef4444"; // red - overdue
    if (minutesLeft <= 120) return "#f59e0b"; // amber - < 2 hours
    return "#22c55e"; // green - > 2 hours
  };

  // Determine pulse animation class
  const isUrgent = minutesLeft > 0 && minutesLeft <= 120;

  const ringSize = 52;
  const strokeWidth = 3;
  const radius = (ringSize - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  // Ring is always full (shows time in center, not progress)
  const strokeDasharray = circumference;

  return (
    <div
      className={cn(
        "relative inline-flex items-center justify-center",
        isUrgent ? "animate-pulse" : "",
        className
      )}
      style={isUrgent ? { animationDuration: "1s" } : {}}
    >
      {/* Ring gauge SVG */}
      <svg
        width={ringSize}
        height={ringSize}
        viewBox={`0 0 ${ringSize} ${ringSize}`}
        className="shrink-0"
      >
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-white/10"
        />
        <circle
          cx={ringSize / 2}
          cy={ringSize / 2}
          r={radius}
          fill="none"
          stroke={getStrokeColor()}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          strokeLinecap="round"
          strokeDashoffset={0}
          className="transition-colors duration-300"
        />
      </svg>
      {/* Time display — absolutely centred over the ring */}
      <span className="absolute inset-0 flex items-center justify-center text-center text-[9px] font-bold font-mono tabular-nums leading-tight text-current pointer-events-none">
        {displayText}
      </span>
    </div>
  );
}
