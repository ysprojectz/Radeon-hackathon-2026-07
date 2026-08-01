"use client";
import { ShieldCheck, ShieldX } from "lucide-react";
import { cn } from "@/lib/utils";

interface HashChainBadgeProps {
  valid: boolean;
  className?: string;
}

export function HashChainBadge({ valid, className }: HashChainBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        valid
          ? "bg-green-100 text-green-700"
          : "bg-red-100 text-red-700",
        className
      )}
    >
      {valid ? (
        <ShieldCheck className="h-3.5 w-3.5" />
      ) : (
        <ShieldX className="h-3.5 w-3.5" />
      )}
      {valid ? "Chain Valid" : "Chain Invalid"}
    </span>
  );
}
