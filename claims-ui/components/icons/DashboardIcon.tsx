/**
 * DashboardIcon - Animated four-square dashboard icon
 * Displays 4 squares colored yellow, green, blue, red with animation
 */

import { cn } from "@/lib/utils";

interface DashboardIconProps {
  className?: string;
  animated?: boolean;
}

export function DashboardIcon({ className, animated = true }: DashboardIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("dashboard-icon", className)}
    >
      {/* Top-left square - Yellow */}
      <rect
        x="3"
        y="3"
        width="8"
        height="8"
        rx="1.5"
        className={cn(
          "fill-yellow-500 dark:fill-yellow-400",
          animated && "animate-pulse-yellow"
        )}
        style={{ animationDelay: "0s", animationDuration: "2s" }}
      />

      {/* Top-right square - Green */}
      <rect
        x="13"
        y="3"
        width="8"
        height="8"
        rx="1.5"
        className={cn(
          "fill-green-500 dark:fill-green-400",
          animated && "animate-pulse-green"
        )}
        style={{ animationDelay: "0.5s", animationDuration: "2s" }}
      />

      {/* Bottom-left square - Blue */}
      <rect
        x="3"
        y="13"
        width="8"
        height="8"
        rx="1.5"
        className={cn(
          "fill-blue-500 dark:fill-blue-400",
          animated && "animate-pulse-blue"
        )}
        style={{ animationDelay: "1s", animationDuration: "2s" }}
      />

      {/* Bottom-right square - Red */}
      <rect
        x="13"
        y="13"
        width="8"
        height="8"
        rx="1.5"
        className={cn(
          "fill-red-500 dark:fill-red-400",
          animated && "animate-pulse-red"
        )}
        style={{ animationDelay: "1.5s", animationDuration: "2s" }}
      />

      <style jsx>{`
        @keyframes pulse-glow {
          0%, 100% {
            opacity: 1;
            filter: brightness(1);
          }
          50% {
            opacity: 0.8;
            filter: brightness(1.3) drop-shadow(0 0 4px currentColor);
          }
        }

        .animate-pulse-yellow {
          animation: pulse-glow 2s ease-in-out infinite;
          animation-delay: 0s;
        }

        .animate-pulse-green {
          animation: pulse-glow 2s ease-in-out infinite;
          animation-delay: 0.5s;
        }

        .animate-pulse-blue {
          animation: pulse-glow 2s ease-in-out infinite;
          animation-delay: 1s;
        }

        .animate-pulse-red {
          animation: pulse-glow 2s ease-in-out infinite;
          animation-delay: 1.5s;
        }
      `}</style>
    </svg>
  );
}
