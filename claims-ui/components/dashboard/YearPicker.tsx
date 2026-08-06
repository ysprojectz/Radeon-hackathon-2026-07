"use client";

import * as React from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface YearPickerProps {
  selectedYear: number | "Current";
  onYearChange: (year: number | "Current") => void;
  className?: string;
}

const YEARS: (number | "Current")[] = ["Current", 2025, 2024, 2023];

export function YearPicker({ selectedYear, onYearChange, className }: YearPickerProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-semibold transition-all duration-200 hover:bg-white/[0.08] hover:text-white focus:outline-none",
            selectedYear !== "Current" && "border-[var(--status-info)]/35 bg-[var(--status-info)]/14 text-[var(--status-info)]",
            className
          )}
        >
          <span>{selectedYear === "Current" ? "Year" : selectedYear}</span>
          <ChevronDown className={cn("h-4 w-4 text-white/40 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[140px] p-1 glass-card border-white/[0.1] shadow-2xl">
        <div 
          className="custom-scrollbar max-h-[200px] overflow-y-auto overscroll-contain py-1"
          style={{
            scrollbarWidth: 'none',
          }}
        >
          {YEARS.map((year) => {
            const isSelected = selectedYear === year;
            return (
              <DropdownMenuItem
                key={year}
                onSelect={(e) => {
                  e.preventDefault();
                  onYearChange(year);
                  setOpen(false);
                }}
                className={cn(
                  "relative flex w-full cursor-pointer select-none items-center justify-between rounded-lg px-3 py-2.5 text-sm font-bold outline-none transition-all focus:bg-white/[0.06]",
                  isSelected
                    ? "bg-[var(--status-info)]/15 text-[var(--status-info)] shadow-[inset_0_0_0_1px_rgba(37,99,235,0.2)]"
                    : "text-white/60 hover:text-white"
                )}
              >
                <span className="relative z-10">{year}</span>
                {isSelected && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--status-info)]/20 shadow-[0_0_12px_rgba(37,99,235,0.3)]">
                    <Check className="h-3 w-3 text-[var(--status-info)]" strokeWidth={3} />
                  </div>
                )}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
