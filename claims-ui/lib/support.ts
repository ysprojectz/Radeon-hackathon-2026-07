"use client";

export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type SupportTicketPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** Accepted MIME types for ticket attachments. */
export const ATTACHMENT_ACCEPT = ["image/png", "image/jpeg", "application/pdf"] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_ACCEPT)[number];

/** Maximum size per attachment in bytes (5 MB). */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  category: string;
  priority: SupportTicketPriority | string;
  status: SupportTicketStatus | string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Attachment filenames or URLs returned by the backend (optional). */
  attachments?: string[];
  claim_reference?: string | null;
  page_route?: string;
  market_region?: string;
  tenant_id?: string;
  resolution_notes?: string;
  resolved_by?: string | null;
  resolved_at?: string | null;
}

export interface SupportTicketInput {
  subject: string;
  description: string;
  category: string;
  priority: SupportTicketPriority;
  claim_reference?: string;
  page_route?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requestSupport(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Try to extract a detail message from the JSON body (FastAPI error shape).
    let detail: string | undefined;
    try {
      const body = await res.clone().json();
      detail = typeof body?.detail === "string" ? body.detail : undefined;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail ?? `Support request failed (${res.status})`);
  }
  return res.json();
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function fetchSupportTickets(): Promise<SupportTicket[]> {
  const data = await requestSupport("/api/v1/support/tickets");
  return Array.isArray(data) ? (data as SupportTicket[]) : [];
}

/**
 * Create a ticket without attachments (JSON path — unchanged behaviour).
 */
export async function createSupportTicket(ticket: SupportTicketInput): Promise<SupportTicket> {
  return requestSupport("/api/v1/support/tickets", {
    method: "POST",
    body: JSON.stringify(ticket),
  });
}

/**
 * Create a ticket with optional file attachments.
 * Sends multipart/form-data so files are forwarded to the backend.
 * Falls back to the plain JSON path when no files are provided.
 */
export async function createSupportTicketWithAttachments(
  ticket: SupportTicketInput,
  files: File[],
): Promise<SupportTicket> {
  if (files.length === 0) {
    return createSupportTicket(ticket);
  }

  const form = new FormData();
  form.append("subject", ticket.subject);
  form.append("description", ticket.description);
  form.append("category", ticket.category);
  form.append("priority", ticket.priority);
  for (const file of files) {
    form.append("attachments", file, file.name);
  }

  // Do NOT set Content-Type — the browser sets it with the correct boundary.
  return requestSupport("/api/v1/support/tickets", {
    method: "POST",
    body: form,
  });
}

export async function updateSupportTicketStatus(
  id: string,
  status: SupportTicketStatus,
  resolution_notes?: string,
): Promise<SupportTicket> {
  return requestSupport(`/api/v1/support/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ status, resolution_notes }),
  });
}

export function getSupportTicketAttachmentHref(
  ticketId: string,
  filename: string,
  options?: { admin?: boolean },
): string {
  const root = options?.admin ? "/api/v1/proxy/admin/support" : "/api/v1/proxy/support";
  return `${root}/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(filename)}`;
}

export function getSupportTicketClaimHref(ticket: Pick<SupportTicket, "claim_reference" | "page_route">): string | null {
  const claimReference = ticket.claim_reference?.trim();
  if (!claimReference) return null;
  if (ticket.page_route?.startsWith("/claims-advance/")) {
    return `/claims-advance/${encodeURIComponent(claimReference)}`;
  }
  return `/claims/${encodeURIComponent(claimReference)}`;
}
