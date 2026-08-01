"use client";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { DayPicker } from "react-day-picker";
import { format } from "date-fns";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";
import "react-day-picker/style.css";

interface DateRangePickerProps {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  error?: string | null;
  compact?: boolean; // single-month view for narrow containers (e.g. slide-out panels)
  portalContainer?: HTMLElement | null;
}

export function DateRangePicker({
  from,
  to,
  onFromChange,
  onToChange,
  error,
  compact = false,
  portalContainer,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const fromDate = from ? new Date(from + "T00:00:00") : undefined;
  const toDate = to ? new Date(to + "T00:00:00") : undefined;

  // Ensure dates are valid
  const validFromDate = fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined;
  const validToDate = toDate && !isNaN(toDate.getTime()) ? toDate : undefined;
  const defaultMonth = validFromDate ?? validToDate ?? new Date();

  // Close on outside click
  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const target = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(target) &&
        popupRef.current &&
        !popupRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function updatePopupPosition() {
      const trigger = triggerRef.current;
      const popup = popupRef.current;
      if (!trigger || !popup) return;

      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gap = 8;
      const preferredWidth = compact ? 320 : 640;
      const width = Math.min(preferredWidth, viewportWidth - 24);
      const left = Math.min(
        Math.max(12, rect.left),
        Math.max(12, viewportWidth - width - 12)
      );
      // Use measured height when available; fall back to a safe estimate so
      // above/below placement is correct even on the first render frame.
      const measuredHeight = popup.getBoundingClientRect().height;
      const popupHeight = measuredHeight > 0 ? measuredHeight : (compact ? 400 : 640);
      const showAbove =
        rect.bottom + gap + popupHeight > viewportHeight - 12 &&
        rect.top - gap - popupHeight >= 12;

      setPopupStyle({
        position: "fixed",
        top: showAbove ? rect.top - popupHeight - gap : rect.bottom + gap,
        left,
        width,
        zIndex: 9999,
      });
    }

    // Double-RAF: first frame mounts the portal, second frame has a laid-out height
    let raf2: number;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(updatePopupPosition);
    });

    // Re-measure when popup content resizes (e.g. month navigation)
    const ro = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updatePopupPosition)
      : null;
    if (popupRef.current) ro?.observe(popupRef.current);

    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      ro?.disconnect();
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [compact, open]);

  function handleSelect(range: { from?: Date; to?: Date } | undefined) {
    if (range?.from) {
      onFromChange(format(range.from, "yyyy-MM-dd"));
    }
    if (range?.from && !range?.to) {
      onToChange("");
    }
    if (range?.to) {
      onToChange(format(range.to, "yyyy-MM-dd"));
    }
    if (range?.from && range?.to) {
      setOpen(false);
    }
  }

  function handleClear() {
    onFromChange("");
    onToChange("");
  }

  const formatDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr + "T00:00:00"), "dd MMM yyyy");
    } catch {
      return "Invalid date";
    }
  };

  const displayText = from && to
    ? `${formatDate(from)} — ${formatDate(to)}`
    : from
    ? `${formatDate(from)} — Select end`
    : to
    ? `Until ${formatDate(to)}`
    : "Select date range";

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          ref={triggerRef}
          onClick={() => setOpen(!open)}
          className={cn(
            "flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-all",
            error
              ? "border-red-500 dark:border-red-500 dark:text-red-400 text-red-600"
              : from || to
              ? "dark:bg-cyan-500/10 bg-cyan-50 dark:text-cyan-400 text-cyan-600 dark:border-cyan-500/30 border-cyan-200"
              : "dark:bg-white/[0.04] bg-slate-100 dark:text-slate-400 text-slate-500 dark:border-white/10 border-slate-200 dark:hover:bg-white/[0.06] hover:bg-slate-200"
          )}
        >
          <Calendar className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{displayText}</span>
        </button>
        {(from || to) && (
          <button
            type="button"
            aria-label="Clear date range"
            onClick={handleClear}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/45 transition hover:bg-white/[0.08] hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && portalReady && createPortal(
        <div
          ref={popupRef}
          style={popupStyle}
          className={cn(
            "pointer-events-auto rounded-xl overflow-hidden shadow-2xl",
            "dark:bg-[#1a1d26] bg-white border dark:border-white/10 border-slate-200",
            "p-3"
          )}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <style>{`
            .rdp-root {
              --rdp-accent-color: #06b6d4;
              --rdp-accent-background-color: rgba(6, 182, 212, 0.15);
              --rdp-range_middle-background-color: rgba(6, 182, 212, 0.08);
              --rdp-range_middle-color: inherit;
              --rdp-outside-opacity: 0.4;
              --rdp-cell-size: 32px;
              font-size: 13px;
            }
            .rdp-padding .rdp-months {
              padding: 8px;
            }
            .rdp-padding .rdp-thead {
              padding: 0 8px;
            }
            .dark .rdp-root {
              --rdp-accent-color: #22d3ee;
              --rdp-accent-background-color: rgba(6, 182, 212, 0.2);
              --rdp-range_middle-background-color: rgba(6, 182, 212, 0.1);
              --rdp-cell-size: 32px;
              color: #e2e8f0;
            }
            .dark .rdp-root .rdp-day {
              color: #cbd5e1;
              min-width: 32px;
              height: 32px;
            }
            .dark .rdp-root .rdp-day:hover {
              background: rgba(255,255,255,0.08);
            }
            .dark .rdp-root .rdp-day_selected {
              background: var(--rdp-accent-background-color);
              color: var(--rdp-accent-color);
            }
            .dark .rdp-root .rdp-caption_label {
              color: #f1f5f9;
              font-weight: 600;
            }
            .dark .rdp-root .rdp-button_previous,
            .dark .rdp-root .rdp-button_next {
              color: #94a3b8;
              padding: 4px 8px;
            }
            .dark .rdp-root .rdp-button_previous:hover,
            .dark .rdp-root .rdp-button_next:hover {
              background: rgba(255,255,255,0.1);
            }
            .dark .rdp-root .rdp-weekday {
              color: #64748b;
              font-weight: 500;
              font-size: 11px;
            }
            .rdp-day_today {
              border: 2px solid var(--rdp-accent-color);
            }
          `}</style>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[10px] font-bold uppercase tracking-widest dark:text-slate-500 text-slate-500">From</span>
              <input
                type="date"
                value={from}
                onChange={(event) => onFromChange(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[10px] font-bold uppercase tracking-widest dark:text-slate-500 text-slate-500">To</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(event) => onToChange(event.target.value)}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-cyan-400 dark:border-white/10 dark:bg-white/[0.04] dark:text-white"
              />
            </label>
          </div>
          <DayPicker
            mode="range"
            selected={validFromDate || validToDate ? { from: validFromDate, to: validToDate } : undefined}
            onSelect={handleSelect}
            defaultMonth={defaultMonth}
            numberOfMonths={compact ? 1 : 2}
            className="rdp-padding"
          />
        </div>,
        portalContainer ?? document.body
      )}

      {error && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
