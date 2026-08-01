"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import React from "react";
import { Plus, ChevronRight, ChevronLeft, Trash2, CalendarDays, AlertTriangle, Zap, Eye, CheckSquare, Tag, Bell, Briefcase, CalendarClock, CheckCircle2, ClipboardCheck, ListTodo, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { toast } from "sonner";
import { mutate } from "swr";
import { Card, CardAccent, CardGlow } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarEvents,
  loadStoredCalendarEvents,
  notifyCalendarEventsChanged,
  saveStoredCalendarEvents,
  updateCalendarEvent,
  type CalendarEvent,
  type CalendarEventType,
} from "@/lib/calendar";

// ── Event type display configurations ────────────────────────────────────────

/**
 * Display configuration for each event type
 * Maps calendar event types to UI styling and labels
 */
const EVENT_TYPES: Record<CalendarEventType, {
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  bg: string;
  border: string;
  text: string;
  dot: string;
}> = {
  TODO_TASK: {
    label: "Todo Task",
    shortLabel: "Todo",
    icon: ListTodo,
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
    text: "text-emerald-300",
    dot: "bg-emerald-300",
  },
  REMINDER: {
    label: "Reminder",
    shortLabel: "Reminder",
    icon: Bell,
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    text: "text-cyan-300",
    dot: "bg-cyan-300",
  },
  MEETING: {
    label: "Meeting",
    shortLabel: "Meeting",
    icon: CalendarClock,
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
    text: "text-sky-300",
    dot: "bg-sky-300",
  },
  SCHEDULE: {
    label: "Schedule",
    shortLabel: "Schedule",
    icon: Briefcase,
    bg: "bg-fuchsia-500/10",
    border: "border-fuchsia-500/20",
    text: "text-fuchsia-300",
    dot: "bg-fuchsia-300",
  },
  DEADLINE: {
    label: "Deadline",
    shortLabel: "Deadline",
    icon: ClipboardCheck,
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    text: "text-rose-300",
    dot: "bg-rose-300",
  },
  // Legacy types
  PRIORITY: {
    label: "Priority",
    shortLabel: "Priority",
    icon: AlertTriangle,
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    text: "text-orange-400",
    dot: "bg-orange-400",
  },
  NEURAL: {
    label: "System",
    shortLabel: "System",
    icon: Zap,
    bg: "bg-brand-primary/10",
    border: "border-brand-primary/20",
    text: "text-brand-primary",
    dot: "bg-brand-primary",
  },
  REVIEW: {
    label: "Manual Review",
    shortLabel: "Review",
    icon: Eye,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  AUDIT: {
    label: "Audit",
    shortLabel: "Audit",
    icon: CheckSquare,
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    text: "text-rose-400",
    dot: "bg-rose-400",
  },
  CUSTOM: {
    label: "Custom",
    shortLabel: "Custom",
    icon: Tag,
    bg: "bg-sky-500/10",
    border: "border-sky-500/20",
    text: "text-sky-400",
    dot: "bg-sky-400",
  },
  // New industrial types
  HITL_REVIEW: {
    label: "Manual Review",
    shortLabel: "Review",
    icon: Eye,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  AUDIT_REQUIRED: {
    label: "Audit Required",
    shortLabel: "Audit",
    icon: CheckSquare,
    bg: "bg-rose-500/10",
    border: "border-rose-500/20",
    text: "text-rose-400",
    dot: "bg-rose-400",
  },
  SETTLEMENT_DUE: {
    label: "Settlement Due",
    shortLabel: "Settle",
    icon: Zap,
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
  },
  DENIAL_APPEAL: {
    label: "Denial Appeal",
    shortLabel: "Appeal",
    icon: AlertTriangle,
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    text: "text-red-400",
    dot: "bg-red-400",
  },
  DOCUMENT_EXPIRY: {
    label: "Document Expiry",
    shortLabel: "Expiry",
    icon: CalendarDays,
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
    text: "text-violet-400",
    dot: "bg-violet-400",
  },
  MANUAL_REVIEW: {
    label: "Manual Review",
    shortLabel: "Manual",
    icon: Eye,
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    text: "text-purple-400",
    dot: "bg-purple-400",
  },
  SYSTEM_CHECK: {
    label: "System Check",
    shortLabel: "System",
    icon: Zap,
    bg: "bg-brand-primary/10",
    border: "border-brand-primary/20",
    text: "text-brand-primary",
    dot: "bg-brand-primary",
  },
};

const CREATE_TYPE_OPTIONS: Array<{ value: Extract<CalendarEventType, "TODO_TASK" | "MEETING" | "REMINDER">; label: string }> = [
  { value: "TODO_TASK", label: "TODO" },
  { value: "MEETING", label: "Meeting schedule" },
  { value: "REMINDER", label: "Reminder" },
];

const SMART_CREATE_OPTIONS: Record<"TODO_TASK" | "MEETING" | "REMINDER", string[]> = {
  TODO_TASK: [
    "Review pending claim decision",
    "Follow up missing document",
    "Prepare settlement action",
    "Validate policy exception",
  ],
  MEETING: [
    "Schedule claim review meeting",
    "Book provider clarification call",
    "Plan settlement approval discussion",
    "Set audit alignment meeting",
  ],
  REMINDER: [
    "Remind me to check claim status",
    "Remind me before SLA cutoff",
    "Remind me to send document request",
    "Remind me to verify payment status",
  ],
};

const CREATE_FIELD_COPY: Record<"TODO_TASK" | "MEETING" | "REMINDER", {
  titlePlaceholder: string;
  locationLabel: string;
  locationPlaceholder: string;
  notesLabel: string;
  notesPlaceholder: string;
  reminderOptions: Array<{ value: number; label: string }>;
}> = {
  TODO_TASK: {
    titlePlaceholder: "Write the task to complete",
    locationLabel: "Work Area",
    locationPlaceholder: "e.g. HITL queue, settlement desk, policy review",
    notesLabel: "Task Details",
    notesPlaceholder: "Add checklist, documents needed, or expected outcome.",
    reminderOptions: [
      { value: 0, label: "At task time" },
      { value: 30, label: "30 minutes before" },
      { value: 60, label: "1 hour before" },
      { value: 1440, label: "1 day before" },
    ],
  },
  MEETING: {
    titlePlaceholder: "Write the meeting title",
    locationLabel: "Meeting Place or Link",
    locationPlaceholder: "e.g. Teams link, Zoom, claims war room",
    notesLabel: "Agenda",
    notesPlaceholder: "Add attendees, agenda, required claim IDs, or decisions needed.",
    reminderOptions: [
      { value: 15, label: "15 minutes before" },
      { value: 30, label: "30 minutes before" },
      { value: 60, label: "1 hour before" },
      { value: 1440, label: "1 day before" },
    ],
  },
  REMINDER: {
    titlePlaceholder: "Write what should be remembered",
    locationLabel: "Reference",
    locationPlaceholder: "e.g. claim ID, policy number, team, or link",
    notesLabel: "Reminder Note",
    notesPlaceholder: "Add context, trigger reason, or the action to take.",
    reminderOptions: [
      { value: 0, label: "At reminder time" },
      { value: 15, label: "15 minutes before" },
      { value: 30, label: "30 minutes before" },
      { value: 60, label: "1 hour before" },
    ],
  },
};

const WRITE_OWN_OPTION = "__WRITE_OWN__";

// Backward compatibility: map legacy types for display
const LEGACY_TYPE_DISPLAY: Record<string, CalendarEventType> = {
  NEURAL: "SYSTEM_CHECK",
  REVIEW: "HITL_REVIEW",
  AUDIT: "AUDIT_REQUIRED",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ── Interface ─────────────────────────────────────────────────────────────────

interface CalendarCardProps {
  systemEvents?: CalendarEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert date to local YYYY-MM-DD format (respects user's timezone)
 */
function toLocalISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get Monday of the given date (start of ISO week)
 */
function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const dow = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const offset = dow === 0 ? -6 : 1 - dow; // If Sunday, go back 6; otherwise go back (dow - 1)
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Format time for display (12-hour format)
 */
function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Get full month name for display
 */
function formatMonth(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/**
 * Get full date for display
 */
function formatFullDate(isoDate: string): string {
  return new Date(isoDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short", 
    day: "numeric",
  });
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDateISO(): string {
  return toLocalISO(new Date());
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CalendarCard({ systemEvents = [] }: CalendarCardProps) {
  const today = useMemo(() => new Date(), []);
  const todayISO = toLocalISO(today);
  const dateRailRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  });
  
  // State for week navigation
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(today));
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [userEvents, setUserEvents] = useState<CalendarEvent[]>([]);
  const [showModal, setShowModal] = useState(false);

  // Form state for new event
  const [form, setForm] = useState({
    title: "",
    date: todayISO,
    time: "09:00",
    type: "TODO_TASK" as Extract<CalendarEventType, "TODO_TASK" | "MEETING" | "REMINDER">,
    smartTitle: WRITE_OWN_OPTION,
    notes: "",
    location: "",
    priority: "MEDIUM",
    reminder_minutes: 30,
  });
  const [formError, setFormError] = useState("");

  // Load user events from API/Storage
  useEffect(() => {
    fetchCalendarEvents()
      .then(setUserEvents)
      .catch(() => {
        const cachedEvents = loadStoredCalendarEvents();
        setUserEvents(cachedEvents);
        toast.error("Calendar sync failed", {
          description: cachedEvents.length
            ? "Showing locally cached events. New changes will require database access."
            : "Task data is unavailable until database access is restored.",
        });
      });
  }, []);

  // Migrate legacy event types for consistent display
  const normalizeEventType = useCallback((type: CalendarEventType): CalendarEventType => {
    return (LEGACY_TYPE_DISPLAY[type] || type) as CalendarEventType;
  }, []);

  // Merge and sort all events
  const allEvents: CalendarEvent[] = useMemo(() => [
    ...systemEvents.map((e) => ({ ...e, system: true })),
    ...userEvents,
  ].sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.time.localeCompare(b.time);
  }), [systemEvents, userEvents]);

  // Get events for currently selected date
  const dayEvents = useMemo(() => {
    return allEvents.filter((e) => e.date === selectedDate);
  }, [allEvents, selectedDate]);

  const createCopy = CREATE_FIELD_COPY[form.type];

  // Get dates that have events for dot indicators
  // Normalize event dates to local ISO format for comparison
  const eventDates = useMemo(() => {
    return new Set(allEvents.map((e) => {
      // If event date is already in local format, use it as-is
      // If it's in UTC format, it will still match as long as the local date is the same
      return e.date;
    }));
  }, [allEvents]);

  // Build date rail around the active week so users can freely drag through nearby dates.
  const railDates = useMemo(() => {
    return Array.from({ length: 35 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() - 14 + i);
      return d;
    });
  }, [weekStart]);

  const weekDates = useMemo(() => {
    return DAY_LABELS.map((_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  // Month/year label for header
  const monthLabel = formatMonth(weekDates[0]);

  // Navigation handlers
  const prevWeek = useCallback(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  }, [weekStart]);

  const nextWeek = useCallback(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  }, [weekStart]);

  const goToToday = useCallback(() => {
    setWeekStart(getMondayOf(today));
    setSelectedDate(todayISO);
  }, [today, todayISO]);

  useEffect(() => {
    const rail = dateRailRef.current;
    if (!rail) return;

    const selected = rail.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    if (!selected) return;

    const left = selected.offsetLeft - (rail.clientWidth - selected.clientWidth) / 2;
    rail.scrollTo({ left: Math.max(left, 0), behavior: "smooth" });
  }, [selectedDate, weekStart]);

  const handleRailMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rail = dateRailRef.current;
    if (!rail) return;

    dragState.current = {
      isDown: true,
      startX: event.pageX - rail.offsetLeft,
      scrollLeft: rail.scrollLeft,
      moved: false,
    };
    rail.style.cursor = "grabbing";
  }, []);

  const handleRailMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rail = dateRailRef.current;
    if (!rail || !dragState.current.isDown) return;

    event.preventDefault();
    const x = event.pageX - rail.offsetLeft;
    const walk = (x - dragState.current.startX) * 1.15;
    if (Math.abs(walk) > 4) dragState.current.moved = true;
    rail.scrollLeft = dragState.current.scrollLeft - walk;
  }, []);

  const stopRailDrag = useCallback(() => {
    const rail = dateRailRef.current;
    dragState.current.isDown = false;
    if (rail) rail.style.cursor = "grab";
  }, []);

  const handleRailWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const rail = dateRailRef.current;
    if (!rail) return;

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    rail.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

  // Handle date selection - keeps weekStart in sync
  const handleDateSelect = useCallback((isoDate: string) => {
    // Prevent selecting past dates
    if (isoDate < todayISO) {
      toast.error("Cannot select past dates", { description: "Please select a current or future date." });
      return;
    }
    
    const newDate = new Date(isoDate + "T00:00:00");
    const newWeekStart = getMondayOf(newDate);
    
    // Only update weekStart if the selected date is not in the current week
    if (!weekDates.some(d => toLocalISO(d) === isoDate)) {
      setWeekStart(newWeekStart);
    }
    setSelectedDate(isoDate);
  }, [weekDates, todayISO]);

  // Modal handlers
  const openModal = useCallback(() => {
    setForm({
      title: "",
      date: selectedDate,
      time: "09:00",
      type: "TODO_TASK",
      smartTitle: WRITE_OWN_OPTION,
      notes: "",
      location: "",
      priority: "MEDIUM",
      reminder_minutes: 30,
    });
    setFormError("");
    setShowModal(true);
  }, [selectedDate]);

  const closeModal = useCallback(() => setShowModal(false), []);

  const handleAdd = useCallback(async () => {
    if (!form.title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!form.date) {
      setFormError("Date is required.");
      return;
    }
    if (!form.time) {
      setFormError("Time is required.");
      return;
    }
    
    // Prevent adding events for past dates
    if (form.date < todayISO) {
      setFormError("Cannot add events for past dates.");
      return;
    }

    const newEvent: CalendarEvent = {
      id: crypto.randomUUID(),
      title: form.title.trim(),
      date: form.date,
      time: form.time,
      type: form.type,
      notes: form.notes.trim() || undefined,
      location: form.location.trim() || undefined,
      priority: form.priority,
      reminder_minutes: form.reminder_minutes,
      status: "OPEN",
    };

    try {
      const savedEvent = await createCalendarEvent(newEvent);
      const updated = [...userEvents.filter((event) => event.id !== savedEvent.id), savedEvent];
      setUserEvents(updated);
      saveStoredCalendarEvents(updated);
      notifyCalendarEventsChanged();
      mutate("dashboard-calendar-events", updated, false);
      
      // Update view to show the new event's date
      setSelectedDate(form.date);
      setWeekStart(getMondayOf(new Date(form.date + "T00:00:00")));
      
      toast.success("Calendar reminder added", { description: savedEvent.title });
      closeModal();
    } catch {
      toast.error("Failed to add event", { description: "Please try again." });
    }
  }, [form, userEvents, closeModal, todayISO]);

  const handleToggleDone = useCallback(async (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (event.system) return;
    const nextStatus = event.status === "DONE" ? "OPEN" : "DONE";
    const nextEvent = { ...event, status: nextStatus };
    try {
      const savedEvent = await updateCalendarEvent(nextEvent);
      const updated = userEvents.map((item) => item.id === savedEvent.id ? savedEvent : item);
      setUserEvents(updated);
      saveStoredCalendarEvents(updated);
      notifyCalendarEventsChanged();
      mutate("dashboard-calendar-events", updated, false);
      toast.success(nextStatus === "DONE" ? "Task marked done" : "Task reopened", { description: savedEvent.title });
    } catch {
      toast.error("Failed to update event", { description: "The task status was not saved." });
    }
  }, [userEvents]);

  const handleDelete = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await deleteCalendarEvent(id);
      const updated = userEvents.filter((e) => e.id !== id);
      setUserEvents(updated);
      saveStoredCalendarEvents(updated);
      notifyCalendarEventsChanged();
      mutate("dashboard-calendar-events", updated, false);
      toast.success("Calendar reminder removed");
    } catch {
      toast.error("Failed to delete event", { description: "Please try again." });
    }
  }, [userEvents]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Card variant="dashboard" className="flex h-full min-h-[360px] flex-col xl:min-h-[410px]">
        {/* Cyan theme accent and glow */}
        <CardAccent className="bg-gradient-to-r from-cyan-400/0 via-cyan-400/50 to-cyan-400/0" />
        <CardGlow className="-bottom-8 -right-8 bg-cyan-400/30" />

        {/* Header */}
        <div className="relative flex items-center justify-between px-4 pt-4 pb-2.5">
          <div className="dashboard-panel-title">
            <span className="dashboard-panel-dot bg-cyan-300" />
            <div>
              <h3 className="dashboard-panel-label">TODO & Task</h3>
            </div>
          </div>
          <button
            onClick={openModal}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-primary shadow-[0_0_18px_rgba(0,216,214,0.28)] transition-all hover:shadow-[0_0_28px_rgba(0,216,214,0.42)] active:scale-95"
            title="Add event"
            aria-label="Add new calendar event"
          >
            <Plus size={14} className="text-[#0a0a0a]" strokeWidth={3} />
          </button>
        </div>

        {/* Month navigation */}
        <div className="mb-2 flex items-center justify-between px-4">
          <p className="text-[8.5px] font-black uppercase tracking-[0.26em] text-white/24">
            {monthLabel}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={prevWeek}
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.04] transition-colors hover:bg-white/10"
              title="Previous week"
              aria-label="Previous week"
            >
              <ChevronLeft size={12} className="text-white/40" />
            </button>
            <button
              onClick={goToToday}
              className="flex h-6 min-w-[44px] items-center justify-center rounded-full border border-brand-primary/20 bg-brand-primary/10 px-2.5 text-[8px] font-black uppercase tracking-[0.14em] text-brand-primary/80 transition-all hover:border-brand-primary/35 hover:bg-brand-primary/15 hover:text-brand-primary active:scale-95"
              title="Go to today"
              aria-label="Go to today"
            >
              Today
            </button>
            <button
              onClick={nextWeek}
              className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.04] transition-colors hover:bg-white/10"
              title="Next week"
              aria-label="Next week"
            >
              <ChevronRight size={12} className="text-white/40" />
            </button>
          </div>
        </div>

        {/* Date rail - drag left/right for smooth free-flow browsing */}
        <div className="relative px-3 pb-2.5">
          <div className="pointer-events-none absolute bottom-2.5 left-3 top-0 z-10 w-5 bg-gradient-to-r from-[#07080b] to-transparent" />
          <div className="pointer-events-none absolute bottom-2.5 right-3 top-0 z-10 w-5 bg-gradient-to-l from-[#07080b] to-transparent" />
          <div
            ref={dateRailRef}
            onMouseDown={handleRailMouseDown}
            onMouseMove={handleRailMouseMove}
            onMouseUp={stopRailDrag}
            onMouseLeave={stopRailDrag}
            onWheel={handleRailWheel}
            className="custom-scrollbar flex cursor-grab snap-x snap-mandatory items-stretch gap-1 overflow-x-auto overscroll-x-contain scroll-smooth pb-1"
          >
          {railDates.map((date) => {
            const iso = toLocalISO(date);
            const isToday = iso === todayISO;
            const isSelected = iso === selectedDate;
            const hasEvent = eventDates.has(iso);
            const isPast = iso < todayISO;
            const dayIndex = (date.getDay() + 6) % 7;

            return (
              <button
                key={iso}
                type="button"
                data-date={iso}
                onClick={() => {
                  if (dragState.current.moved) return;
                  handleDateSelect(iso);
                }}
                className={cn(
                  "relative flex min-h-[54px] w-[42px] shrink-0 snap-center flex-col items-center gap-0.5 rounded-xl py-1.5 transition-all",
                  isSelected && !isToday ? "border border-white/10 bg-white/[0.07]" : "",
                  isToday ? "bg-brand-primary shadow-[0_0_14px_rgba(0,216,214,0.28)]" : "hover:bg-white/5",
                  isPast && !isToday ? "opacity-35" : ""
                )}
                title={formatFullDate(iso)}
                aria-label={formatFullDate(iso)}
                aria-pressed={isSelected}
              >
                <span 
                  className={cn(
                    "text-[8px] font-black uppercase tracking-[0.14em]",
                    isToday ? "text-[#0a0a0a]" : "text-white/30"
                  )}
                >
                  {DAY_LABELS[dayIndex]}
                </span>
                <span 
                  className={cn(
                    "text-[14px] font-black leading-none",
                    isToday ? "text-[#0a0a0a]" : isSelected ? "text-white" : "text-white/50"
                  )}
                >
                  {date.getDate()}
                </span>
                {/* Event dot indicator */}
                {hasEvent && !isToday && (
                  <span 
                    className="absolute bottom-1.5 h-1 w-1 rounded-full bg-brand-primary"
                    aria-hidden="true"
                  />
                )}
                {/* Today indicator with event */}
                {isToday && hasEvent && (
                  <span 
                    className="absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-white"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
          </div>
        </div>

        {/* Selected date label - displays the actual selected date */}
        <div className="px-4 pb-2">
          <p className="text-[8px] font-black uppercase tracking-[0.18em] text-white/24">
            {formatFullDate(selectedDate)}
          </p>
        </div>

        {/* Events list */}
        <div
          className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 pb-3 pr-2.5"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
            scrollbarGutter: "stable",
          }}
        >
          {dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 py-4 gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.04]">
                <CalendarDays size={14} className="text-white/20" />
              </div>
              <p className="text-[10px] font-black text-white/15 uppercase tracking-widest">
                No events scheduled
              </p>
              <button 
                onClick={openModal} 
                className="text-[9px] font-black text-brand-primary/60 uppercase tracking-widest hover:text-brand-primary transition-colors"
              >
                + Add Event
              </button>
            </div>
          ) : (
            dayEvents.map((evt) => {
              // Normalize event type for display
              const displayType = normalizeEventType(evt.type);
              const typeConfig = EVENT_TYPES[displayType] || EVENT_TYPES.CUSTOM;
              const Icon = typeConfig.icon;
              const isDone = evt.status === "DONE";
              const priorityTone =
                evt.priority === "URGENT" ? "text-rose-300" :
                evt.priority === "HIGH" ? "text-amber-300" :
                evt.priority === "LOW" ? "text-white/30" :
                "text-cyan-200/70";

              const Inner = (
                <div 
                  className={cn(
                    "group relative flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.04] py-3 pl-4 pr-3 transition-colors hover:border-white/[0.1] hover:bg-white/[0.06]",
                    isDone && "opacity-60"
                  )}
                >
                  {/* Left accent bar */}
                  <div 
                    className={cn("absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full", typeConfig.dot)}
                    aria-hidden="true"
                  />
                  
                  {/* Header with time and delete */}
                  <div className="flex items-center justify-between">
                    <span 
                      className={cn("text-[8px] font-black uppercase tracking-[0.2em]", typeConfig.text)}
                    >
                      {typeConfig.shortLabel}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {!evt.system && (
                        <button
                          onClick={(e) => handleToggleDone(evt, e)}
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-full border transition-all",
                            isDone
                              ? "border-emerald-300/35 bg-emerald-300/20 text-emerald-200"
                              : "border-white/[0.12] text-white/24 hover:border-emerald-300/35 hover:text-emerald-200"
                          )}
                          title={isDone ? "Reopen item" : "Mark done"}
                          aria-label={isDone ? `Reopen item: ${evt.title}` : `Mark done: ${evt.title}`}
                        >
                          <CheckCircle2 size={10} />
                        </button>
                      )}
                      <span className="text-[9px] font-black font-mono text-white/30">
                        {formatTime(evt.time)}
                      </span>
                      {!evt.system && (
                        <button
                          onClick={(e) => handleDelete(evt.id, e)}
                          className="w-4 h-4 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:text-rose-400 text-white/30 transition-all"
                          title="Delete event"
                          aria-label={`Delete event: ${evt.title}`}
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Title */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon className={cn("w-3 h-3", typeConfig.text, "shrink-0")} />
                      <span className="text-[12px] font-black text-white/75 group-hover:text-white transition-colors truncate">
                        {evt.title}
                      </span>
                    </div>
                    {evt.href && (
                      <ChevronRight 
                        size={12} 
                        className="text-white/20 group-hover:text-white/50 transition-colors shrink-0"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
                    <span className={cn("text-[8px] font-black uppercase tracking-[0.16em]", priorityTone)}>
                      {evt.priority ?? "MEDIUM"}
                    </span>
                    {evt.reminder_minutes != null && (
                      <span className="flex items-center gap-1 text-[8px] font-semibold text-white/30">
                        <Bell className="h-2.5 w-2.5" />
                        {evt.reminder_minutes}m reminder
                      </span>
                    )}
                    {evt.location && (
                      <span className="flex items-center gap-1 truncate text-[8px] font-semibold text-white/32">
                        <MapPin className="h-2.5 w-2.5" />
                        {evt.location}
                      </span>
                    )}
                  </div>
                  {evt.notes && (
                    <p className="line-clamp-2 pl-5 text-[10px] leading-4 text-white/38">
                      {evt.notes}
                    </p>
                  )}
                </div>
              );

              return evt.href ? (
                <Link 
                  key={evt.id} 
                  href={evt.href} 
                  className="block"
                  title={`View: ${evt.title}`}
                >
                  {Inner}
                </Link>
              ) : (
                <div key={evt.id}>{Inner}</div>
              );
            })
          )}
        </div>
      </Card>

      {/* Add/Edit Event Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[0.82rem] font-black uppercase tracking-[0.2em] text-white">
              Create New
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                Select Type
              </label>
              <select
                value={form.type}
                onChange={(e) => {
                  const nextType = e.target.value as "TODO_TASK" | "MEETING" | "REMINDER";
                  const defaultReminder = CREATE_FIELD_COPY[nextType].reminderOptions[0]?.value ?? 30;
                  setForm((f) => ({
                    ...f,
                    type: nextType,
                    title: "",
                    smartTitle: WRITE_OWN_OPTION,
                    location: "",
                    notes: "",
                    priority: nextType === "REMINDER" ? "MEDIUM" : f.priority,
                    reminder_minutes: defaultReminder,
                  }));
                  setFormError("");
                }}
                className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
              >
                {CREATE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                Smart Selection
              </label>
              <select
                value={form.smartTitle}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({
                    ...f,
                    smartTitle: value,
                    title: value === WRITE_OWN_OPTION ? "" : value,
                  }));
                  setFormError("");
                }}
                className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
              >
                {SMART_CREATE_OPTIONS[form.type].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                <option value={WRITE_OWN_OPTION}>Write own</option>
              </select>
            </div>

            <div className="grid gap-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                Text Entry
              </label>
              <input
                autoFocus
                type="text"
                placeholder={createCopy.titlePlaceholder}
                value={form.title}
                onChange={(e) => {
                  setForm((f) => ({ ...f, title: e.target.value, smartTitle: WRITE_OWN_OPTION }));
                  setFormError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="ui-form-field h-11 w-full text-[13px]"
                maxLength={60}
              />
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                  Date
                </label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  min={getCurrentDateISO()}
                  className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
                />
              </div>
              <div className="grid gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                  Time
                </label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                  Priority
                </label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                  Reminder
                </label>
                <select
                  value={form.reminder_minutes}
                  onChange={(e) => setForm((f) => ({ ...f, reminder_minutes: Number(e.target.value) }))}
                  className="ui-form-field h-11 w-full text-[12px] [color-scheme:dark]"
                >
                  {createCopy.reminderOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                {createCopy.locationLabel}
              </label>
              <input
                type="text"
                placeholder={createCopy.locationPlaceholder}
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="ui-form-field h-11 w-full text-[13px]"
                maxLength={90}
              />
            </div>

            <div className="grid gap-1.5">
              <label className="text-[9px] font-black uppercase tracking-[0.25em] text-white/30">
                {createCopy.notesLabel}
              </label>
              <textarea
                placeholder={createCopy.notesPlaceholder}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="ui-form-field min-h-20 w-full resize-none py-3 text-[13px]"
                maxLength={240}
              />
            </div>

            {/* Error message */}
            {formError && (
              <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter className="pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="ui-button-secondary px-4 py-2.5 text-[11px] font-black uppercase tracking-widest"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              className="ui-button-primary px-4 py-2.5 text-[11px] font-black uppercase tracking-widest"
            >
              Save Item
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Export as default for compatibility
export default CalendarCard;
