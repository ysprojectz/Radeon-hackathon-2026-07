"use client";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "glass-card flex flex-col items-center justify-center gap-3 py-16 text-center",
        className
      )}
    >
      {Icon && (
        <div className="rounded-full bg-slate-900/[0.04] p-4">
          <Icon className="h-10 w-10 text-brand-primary/40" />
        </div>
      )}
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
      {action && (
        <Button onClick={action.onClick} className="ui-button-secondary mt-2">
          {action.label}
        </Button>
      )}
    </div>
  );
}
