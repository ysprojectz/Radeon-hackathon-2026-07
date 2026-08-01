"use client";
import { useId } from "react";
import { Calendar, ChevronDown, Check } from "lucide-react";
import { cn, MONTHS, getMonthName } from "@/lib/utils";
import type { DashboardPeriod } from "@/lib/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface TimePeriodFilterProps {
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  selectedYear?: number | "Current";
  onYearChange?: (year: number | "Current") => void;
  selectedMonth?: number | "Current";
  onMonthChange?: (month: number | "Current") => void;
  customFrom?: string;
  customTo?: string;
  onCustomFromChange?: (date: string) => void;
  onCustomToChange?: (date: string) => void;
}

const PERIOD_BUTTONS = [
  { id: "T" as const, label: "Today", tooltip: "Today's data" },
  { id: "W" as const, label: "Week", tooltip: "This Week (Mon-Sun)" },
  { id: "M" as const, label: "Month", tooltip: "This Month (1st to today)" },
  { id: "Y" as const, label: "Year", tooltip: "This Year (Jan 1 to today)" },
  { id: "C" as const, label: "Custom", tooltip: "Custom date range" },
];

const YEARS: (number | "Current")[] = ["Current", 2025, 2024, 2023];

export function TimePeriodFilter({
  period,
  onPeriodChange,
  selectedYear = "Current",
  onYearChange,
  selectedMonth = "Current",
  onMonthChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: TimePeriodFilterProps) {
  const hasDateError = customFrom && customTo && customFrom > customTo;
  const dateFromId = useId();
  const dateToId = useId();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_BUTTONS.map((btn) => {
          const isActive = period === btn.id;
          
          if (btn.id === "M") {
            return (
              <DropdownMenu key={btn.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={btn.tooltip}
                    onClick={() => onPeriodChange(btn.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 outline-none",
                      isActive
                        ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-200 shadow-[0_14px_32px_rgba(34,211,238,0.18)]"
                        : "border-white/[0.08] bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                    <span>{isActive && selectedMonth !== "Current" ? getMonthName(selectedMonth) : btn.label}</span>
                    <ChevronDown className={cn("h-4 w-4 opacity-40 transition-transform", isActive && "opacity-100")} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[160px] p-1 glass-card border-white/[0.1] shadow-2xl custom-scrollbar max-h-[300px] overflow-y-auto">
                  <DropdownMenuItem
                    onSelect={() => {
                      onPeriodChange("M");
                      onMonthChange?.("Current");
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-all focus:bg-white/[0.06]",
                      isActive && selectedMonth === "Current"
                        ? "bg-cyan-300/15 text-cyan-200"
                        : "text-white/60 hover:text-white"
                    )}
                  >
                    Current Month
                    {isActive && selectedMonth === "Current" && <Check className="h-3.5 w-3.5 text-cyan-300" />}
                  </DropdownMenuItem>
                  {MONTHS.map((month, idx) => (
                    <DropdownMenuItem
                      key={month}
                      onSelect={() => {
                        onPeriodChange("M");
                        onMonthChange?.(idx);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-all focus:bg-white/[0.06]",
                        isActive && selectedMonth === idx
                          ? "bg-cyan-300/15 text-cyan-200"
                          : "text-white/60 hover:text-white"
                      )}
                    >
                      {month}
                      {isActive && selectedMonth === idx && <Check className="h-3.5 w-3.5 text-cyan-300" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          if (btn.id === "Y") {
            return (
              <DropdownMenu key={btn.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={btn.tooltip}
                    onClick={() => onPeriodChange(btn.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200 outline-none",
                      isActive
                        ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-200 shadow-[0_14px_32px_rgba(34,211,238,0.18)]"
                        : "border-white/[0.08] bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white"
                    )}
                  >
                    <span>{isActive && selectedYear !== "Current" ? selectedYear : btn.label}</span>
                    <ChevronDown className={cn("h-4 w-4 opacity-40 transition-transform", isActive && "opacity-100")} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[140px] p-1 glass-card border-white/[0.1] shadow-2xl">
                  {YEARS.map((year) => (
                    <DropdownMenuItem
                      key={year}
                      onSelect={() => {
                        onPeriodChange("Y");
                        onYearChange?.(year);
                      }}
                      className={cn(
                        "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold transition-all focus:bg-white/[0.06]",
                        isActive && selectedYear === year
                          ? "bg-cyan-300/15 text-cyan-200"
                          : "text-white/60 hover:text-white"
                      )}
                    >
                      {year}
                      {isActive && selectedYear === year && <Check className="h-3.5 w-3.5 text-cyan-300" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          }

          return (
            <button
              key={btn.id}
              type="button"
              title={btn.tooltip}
              onClick={() => onPeriodChange(btn.id)}
              className={cn(
                "rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                isActive
                  ? "border-cyan-300/35 bg-cyan-300/14 text-cyan-200 shadow-[0_14px_32px_rgba(34,211,238,0.18)]"
                  : "border-white/[0.08] bg-white/[0.04] text-white/48 hover:bg-white/[0.08] hover:text-white"
              )}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {/* Custom Date Inputs (Inline) */}
      {period === "C" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-white/50" />
              <label htmlFor={dateFromId} className="text-sm text-white/70 font-medium">
                From:
              </label>
              <input
                id={dateFromId}
                type="date"
                value={customFrom ?? ""}
                onChange={(e) => onCustomFromChange?.(e.target.value)}
                className={cn(
                  "ui-form-field h-10 text-sm",
                  hasDateError && "border-red-500"
                )}
              />
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor={dateToId} className="text-sm text-white/70 font-medium">
                To:
              </label>
              <input
                id={dateToId}
                type="date"
                value={customTo ?? ""}
                onChange={(e) => onCustomToChange?.(e.target.value)}
                className={cn(
                  "ui-form-field h-10 text-sm",
                  hasDateError && "border-red-500"
                )}
              />
            </div>
          </div>

          {hasDateError && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <span className="font-bold">⚠</span>
              <span>&quot;From&quot; date cannot be after &quot;To&quot; date</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
