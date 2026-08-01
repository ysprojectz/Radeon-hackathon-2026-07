import React from "react";
import type { LucideIcon } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Stat } from "@/components/ui/Stat";

export interface StatsBarItem {
  label: string;
  value: string;
  meta: string;
  detail?: string;
  icon: LucideIcon;
  accentClass: string;     // text colour — e.g. "text-blue-400"
  glowClass: string;       // bg colour for icon box — e.g. "bg-blue-500/10"
  topLightClass: string;   // starting corner light — e.g. "bg-blue-500/20"
  borderTopClass: string;  // 1-px top accent line — e.g. "bg-blue-500/60"
  surfaceTintClass: string;
}

interface StatsBarProps {
  items: StatsBarItem[];
  isLoading?: boolean;
  onStatClick?: (statLabel: string) => void;
}

function splitCurrencyValue(value: string) {
  const match = value.match(/^([A-Z]{2,4})\s+(.+)$/);
  if (!match) return { prefix: "", amount: value };
  return { prefix: match[1], amount: match[2] };
}

export function StatsBar({ items, isLoading = false, onStatClick }: StatsBarProps) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 mt-6 relative">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:gap-5">
        {items.map((stat) => {
          const valueParts = splitCurrencyValue(stat.value);

          return (
          <Stat
            as="button"
            bare
            key={stat.label}
            type="button"
            onClick={() => onStatClick?.(stat.label)}
            aria-label={onStatClick ? `Open ${stat.label}` : stat.label}
            className="group relative flex min-h-[135px] w-full cursor-pointer flex-col justify-between rounded-[28px] px-4 py-5 text-left transition-all duration-500 hover:-translate-y-1.5 active:translate-y-0 active:scale-[0.985] sm:min-h-[190px] sm:px-5 sm:py-5 xl:min-h-[206px]"
          >
            {/*
              Decoration containment layer — all blurred glow blobs live here.
              overflow-hidden is on THIS div only, so it clips the blur without
              clipping the value text which lives outside this wrapper.
            */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
              {/* Base card surface */}
              <div className="absolute inset-0 border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))] backdrop-blur-3xl shadow-[0_16px_45px_rgba(0,0,0,0.3)] transition-all duration-500 group-hover:border-white/[0.16] group-hover:shadow-[0_24px_60px_rgba(0,0,0,0.42)] group-active:border-white/[0.2] group-active:shadow-[0_12px_28px_rgba(0,0,0,0.36)]" />
              <div className={cn("absolute inset-0 opacity-70 transition-opacity duration-500 group-hover:opacity-100", stat.surfaceTintClass)} />

              {/* Top accent border */}
              <div className={cn("absolute inset-x-0 top-0 h-[2px]", stat.borderTopClass)} />

              {/* Top-left corner radial light — contained, won't bleed to adjacent cards */}
              <div
                className={cn(
                  "absolute -left-10 -top-10 h-40 w-40 rounded-full blur-[58px] opacity-45 transition-all duration-700 group-hover:h-48 group-hover:w-48 group-hover:opacity-95 group-active:opacity-100 sm:h-44 sm:w-44 sm:group-hover:h-52 sm:group-hover:w-52",
                  stat.topLightClass
                )}
              />

              {/* Subtle card background tint from top-left */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/[0.035] via-white/[0.015] to-transparent" />

              {/* Bottom-right residual glow — contained */}
              <div
                className={cn(
                  "absolute -bottom-10 -right-10 h-28 w-28 rounded-full blur-[68px] opacity-20 transition-all duration-700 group-hover:h-36 group-hover:w-36 group-hover:opacity-60 group-active:opacity-70 sm:h-32 sm:w-32 sm:group-hover:h-40 sm:group-hover:w-40",
                  stat.glowClass
                )}
              />

              {/* Inner highlight ring on hover */}
              <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-active:opacity-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(255,255,255,0.02)]" />

              {/* Shimmer sweep on hover */}
              <div className="absolute -inset-[100%] group-hover:inset-0 bg-gradient-to-tr from-transparent via-white/[0.04] to-transparent skew-x-[-20deg] transition-all duration-1000 ease-in-out" />
            </div>

            {/* ── Content — NOT inside overflow-hidden, never clipped ── */}

            {/* Top row — label + icon */}
            <div className="relative z-10 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <span className="ui-eyebrow block truncate text-white/55">{stat.label}</span>
              </div>
              <div className="flex items-start gap-2">
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] backdrop-blur-xl transition-all duration-500 group-hover:scale-110 group-hover:shadow-[0_0_22px_rgba(255,255,255,0.08)] group-active:scale-105 sm:h-12 sm:w-12",
                    stat.glowClass
                  )}
                >
                  <stat.icon size={22} strokeWidth={2.2} className={stat.accentClass} />
                </div>
                <TrendingUp
                  size={15}
                  className={cn("mt-1 shrink-0 opacity-0 transition-all duration-500 group-hover:scale-110 group-hover:opacity-100", stat.accentClass)}
                />
              </div>
            </div>

            {/* Value block — enlarged display number, unclipped */}
            <div className="relative z-10 mt-auto pt-3">
              <h3 className="flex min-w-0 items-baseline gap-2 overflow-hidden font-sans font-black leading-[0.88] tracking-normal text-white">
                {isLoading ? (
                  <span className="inline-block h-[43px] w-40 animate-pulse rounded-xl bg-white/10 align-middle sm:h-[46px] sm:w-44 xl:h-[48px] xl:w-48" />
                ) : (
                  <>
                    {valueParts.prefix && (
                      <span className="shrink-0 text-[0.95rem] font-extrabold tracking-[0.02em] text-white/54 sm:text-[1.05rem] xl:text-[1.15rem]">
                        {valueParts.prefix}
                      </span>
                    )}
                    <span
                      className={cn(
                        "min-w-0 truncate",
                        valueParts.prefix
                          ? "text-[35px] sm:text-[37px] xl:text-[40px]"
                          : "text-[48px] sm:text-[44px] xl:text-[55px]"
                      )}
                    >
                      {valueParts.amount}
                    </span>
                  </>
                )}
              </h3>
            </div>

            {/* Footer row — meta + detail */}
            <div className="relative z-10 mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-semibold text-white/32">{stat.meta}</span>
              </div>
              <div className="max-w-[38%] shrink-0 text-right">
                <div className={cn("text-[10px] font-semibold leading-snug", stat.accentClass)}>
                  {stat.detail ?? ""}
                </div>
              </div>
            </div>
          </Stat>
          );
        })}
      </div>
    </div>
  );
}
