"use client";
import { cn } from "@/lib/utils";
import { Card, cardSurfaceClassName } from "@/components/ui/card";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

// Semantic only (DESIGN_SYSTEM.md §1.2/§1.3) — a KPI's color communicates
// its actual meaning (success/warning/danger/info) or, when it's just a
// plain count with no inherent status, neutral. Never decorative variety.
export type KPIColorScheme = "neutral" | "success" | "warning" | "danger" | "info";

const COLOR_MAP: Record<KPIColorScheme, {
  accent: string;
  text: string;
}> = {
  neutral: { accent: "100 116 139",  text: "text-[var(--text-secondary)]" },
  success: { accent: "5 150 105",    text: "text-[var(--status-success)]" },
  warning: { accent: "217 119 6",    text: "text-[var(--status-warning)]" },
  danger:  { accent: "220 38 38",    text: "text-[var(--status-danger)]" },
  info:    { accent: "37 99 235",    text: "text-brand-primary" },
};

interface KPICardProps {
  title: string;
  value: string | number;
  subLabel?: string;
  deco?: string;
  colorScheme?: KPIColorScheme;
  trend?: { value: number; label?: string };
  accentText?: string;
  footerRight?: string;
  isLoading?: boolean;
  className?: string;
  urgent?: boolean;
  valueColor?: string;
  icon?: React.ElementType;
  href?: string;
  children?: ReactNode;
  compact?: boolean;
}

export function KPICard({
  title,
  value,
  subLabel,
  deco,
  colorScheme = "neutral",
  trend,
  accentText,
  footerRight,
  isLoading,
  className,
  urgent,
  href,
  icon: Icon,
  children,
  compact,
}: KPICardProps) {
  const { accent, text } = COLOR_MAP[colorScheme] || COLOR_MAP.neutral;
  const cardStyle = {
    "--kpi-accent-rgb": accent,
  } as CSSProperties;

  if (isLoading) {
    if (compact) {
      return (
        <Card variant="kpi" className={cn("min-h-[72px]", className)} style={cardStyle}>
          <div className="animate-pulse flex items-center gap-4">
            <div className="h-2 w-20 rounded-full bg-white/[0.14]" />
            <div className="h-6 w-16 rounded-lg bg-white/10" />
            <div className="ml-auto h-2 w-12 rounded-full bg-white/10" />
          </div>
        </Card>
      );
    }
    return (
      <Card
        variant="kpi"
        className={cn("min-h-[140px]", className)}
        style={cardStyle}
      >
        <div className="animate-pulse space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="h-2 w-24 rounded-full bg-white/[0.14]" />
            <div className="h-10 w-10 rounded-2xl bg-white/10" />
          </div>
          <div className="h-10 w-28 rounded-xl bg-white/10" />
          <div className="flex items-center justify-between">
            <div className="h-2 w-20 rounded-full bg-white/10" />
            <div className="h-2 w-14 rounded-full bg-white/10" />
          </div>
        </div>
      </Card>
    );
  }

  if (compact) {
    const compactClass = cn(
      "group min-h-[72px] flex items-center gap-3 py-3",
      href && "cursor-pointer",
      className
    );

    const compactContent = (
      <>
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.10] bg-[rgb(var(--kpi-accent-rgb)/0.15)]">
            <Icon className={cn("h-4 w-4", text)} strokeWidth={2.15} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-black uppercase leading-none tracking-[0.28em] text-white/[0.40]">
            {title}
          </p>
          <p className="mt-1 font-sans text-[1.15rem] font-black leading-none tracking-normal text-white tabular-nums">
            {value}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {subLabel && (
            <span className="block text-[10px] font-medium text-white/25 leading-tight">
              {subLabel}
            </span>
          )}
          {(footerRight || accentText || trend || urgent) && (
            <span
              className={cn(
                "block text-[10px] font-black leading-tight mt-0.5",
                trend && (trend.value >= 0 ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"),
                !trend && urgent && "text-[var(--status-danger)]",
                !trend && !urgent && text
              )}
            >
              {footerRight ??
                accentText ??
                (trend
                  ? (<><span aria-hidden="true">{trend.value >= 0 ? "↑" : "↓"}</span><span className="sr-only">{trend.value >= 0 ? "increased by" : "decreased by"}</span>{` ${Math.abs(trend.value).toFixed(1)}%`}</>)
                  : "Review")}
            </span>
          )}
        </div>
      </>
    );

    if (href) {
      return (
        <Link href={href} className={cardSurfaceClassName("kpi", compactClass)} style={cardStyle} aria-label={`${title}: ${value}`}>
          {compactContent}
        </Link>
      );
    }
    return (
      <Card variant="kpi" className={compactClass} style={cardStyle} role="group" aria-label={`${title}: ${value}`}>
        {compactContent}
      </Card>
    );
  }

  const cardClass = cn(
    "group min-h-[140px]",
    href && "cursor-pointer",
    className
  );

  const cardContent = (
    <>
      {deco && (
        <span
          className="pointer-events-none absolute bottom-2 right-4 select-none font-mono text-[4.75rem] font-black leading-none text-white/[0.035]"
          aria-hidden="true"
        >
          {deco}
        </span>
      )}

      <div className="relative z-10 mb-2 flex items-start justify-between gap-2">
        <p className="min-w-0 line-clamp-2 pt-0.5 text-[10.5px] font-black uppercase leading-tight tracking-[0.28em] text-white/[0.48]">
          {title}
        </p>
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border border-white/[0.12] bg-[rgb(var(--kpi-accent-rgb)/0.18)] shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_20px_rgba(0,0,0,0.22)] backdrop-blur-md">
            <Icon className={cn("h-5 w-5", text)} strokeWidth={2.15} />
          </div>
        )}
      </div>

      <p className="relative z-10 max-w-full break-all pt-1 font-sans text-3xl font-black leading-[0.95] tracking-normal text-white tabular-nums xl:text-4xl">
        {value}
      </p>

      <div className="relative z-10 mt-3 flex min-h-[28px] items-end justify-between gap-2">
        <div className="min-w-0">
          {subLabel && (
            <span className="block line-clamp-2 text-[11px] font-bold leading-tight tracking-normal text-white/35">
              {subLabel}
            </span>
          )}
        </div>
        {(footerRight || accentText || trend || urgent) && (
          <span
            className={cn(
              "min-w-0 shrink-0 text-right text-[11px] font-black leading-tight tracking-normal line-clamp-2",
              trend && (trend.value >= 0 ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"),
              !trend && urgent && "text-[var(--status-danger)]",
              !trend && !urgent && text
            )}
          >
            {footerRight ??
              accentText ??
              (trend
                ? (<><span aria-hidden="true">{trend.value >= 0 ? "↑" : "↓"}</span><span className="sr-only">{trend.value >= 0 ? "increased by" : "decreased by"}</span>{` ${Math.abs(trend.value).toFixed(1)}%${trend.label ? ` ${trend.label}` : ""}`}</>)
                : "Review")}
          </span>
        )}
      </div>

      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cardSurfaceClassName("kpi", cardClass)} style={cardStyle} aria-label={`${title}: ${value}`}>
        {cardContent}
      </Link>
    );
  }

  return (
    <Card variant="kpi" className={cardClass} style={cardStyle} role="group" aria-label={`${title}: ${value}`}>
      {cardContent}
    </Card>
  );
}
