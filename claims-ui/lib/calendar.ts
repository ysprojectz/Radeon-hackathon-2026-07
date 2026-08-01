"use client";

/**
 * Industry-standard calendar event types for health insurance operations
 * Maps to business processes and workflow states
 */
export type CalendarEventType = 
  | "TODO_TASK"      // Action item to complete
  | "REMINDER"       // Reminder without meeting logistics
  | "MEETING"        // Scheduled meeting or call
  | "SCHEDULE"       // Planned operational schedule
  | "DEADLINE"       // Time-bound deadline
  | "PRIORITY"        // Priority claim processing (legacy)
  | "NEURAL"         // Neural/AI processing (legacy, maps to SYSTEM_CHECK)
  | "REVIEW"         // Review required (legacy, maps to HITL_REVIEW)
  | "AUDIT"          // Audit required (legacy, maps to AUDIT_REQUIRED)
  | "CUSTOM"         // User-defined event (legacy)
  | "HITL_REVIEW"    // Human-in-the-loop review required
  | "AUDIT_REQUIRED" // Compliance audit scheduled
  | "SETTLEMENT_DUE" // Payment settlement deadline
  | "DENIAL_APPEAL"  // Denial appeal filing
  | "DOCUMENT_EXPIRY" // Policy/document expiration
  | "MANUAL_REVIEW"  // Manual adjudication needed
  | "SYSTEM_CHECK";   // System maintenance/verification

export interface CalendarEvent {
  id: string;
  date: string;
  time: string;
  type: CalendarEventType;
  title: string;
  href?: string;
  notes?: string;
  location?: string;
  status?: "OPEN" | "DONE" | "CANCELLED" | string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT" | string;
  reminder_minutes?: number | null;
  system?: boolean;
}

export const CALENDAR_STORAGE_KEY = "dashboard_calendar_events";
export const CALENDAR_EVENTS_CHANGED = "dashboard-calendar-events-changed";

function mapCalendarEvent(raw: Record<string, unknown>): CalendarEvent {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    date: String(raw.date ?? ""),
    time: String(raw.time ?? "09:00"),
    type: (raw.type ?? "CUSTOM") as CalendarEventType,
    title: String(raw.title ?? "Untitled event"),
    href: raw.href ? String(raw.href) : undefined,
    notes: raw.notes ? String(raw.notes) : undefined,
    location: raw.location ? String(raw.location) : undefined,
    status: raw.status ? String(raw.status) : "OPEN",
    priority: raw.priority ? String(raw.priority) : "MEDIUM",
    reminder_minutes: raw.reminder_minutes == null ? 30 : Number(raw.reminder_minutes),
  };
}

export function loadStoredCalendarEvents(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CALENDAR_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((event) => mapCalendarEvent(event as Record<string, unknown>));
  } catch {
    return [];
  }
}

export function saveStoredCalendarEvents(events: CalendarEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    CALENDAR_STORAGE_KEY,
    JSON.stringify(events.filter((event) => !event.system))
  );
}

export function notifyCalendarEventsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_EVENTS_CHANGED));
}

async function requestCalendar(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Calendar request failed (${res.status})`);
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const data = await requestCalendar("/api/v1/calendar");
  if (!Array.isArray(data)) throw new Error("Invalid calendar response");
  const events = data.map((event) => mapCalendarEvent(event as Record<string, unknown>));
  saveStoredCalendarEvents(events);
  return events;
}

export async function createCalendarEvent(event: CalendarEvent): Promise<CalendarEvent> {
  const saved = await requestCalendar("/api/v1/calendar", {
    method: "POST",
    body: JSON.stringify(event),
  });
  return mapCalendarEvent((saved ?? event) as Record<string, unknown>);
}

export async function updateCalendarEvent(event: CalendarEvent): Promise<CalendarEvent> {
  const saved = await requestCalendar(`/api/v1/calendar/${event.id}`, {
    method: "PATCH",
    body: JSON.stringify(event),
  });
  return mapCalendarEvent((saved ?? event) as Record<string, unknown>);
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await requestCalendar(`/api/v1/calendar/${eventId}`, { method: "DELETE" });
}
