"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2,
  FileText,
  Headphones,
  LifeBuoy,
  Loader2,
  Paperclip,
  Send,
  TicketCheck,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createSupportTicketWithAttachments,
  fetchSupportTickets,
  getSupportTicketAttachmentHref,
  getSupportTicketClaimHref,
  updateSupportTicketStatus,
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  type SupportTicket,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@/lib/support";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: "CLAIM_ISSUE", label: "Claim Issue" },
  { value: "LOGIN_ACCESS", label: "Login Access" },
  { value: "REPORTS", label: "Reports" },
  { value: "INTEGRATION", label: "Integration" },
  { value: "SYSTEM_BUG", label: "System Bug" },
  { value: "GENERAL", label: "General" },
];

const PRIORITIES: SupportTicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

/** Human-readable labels for the file picker. */
const ACCEPT_ATTR = ATTACHMENT_ACCEPT.join(",");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusTone(status: string) {
  if (status === "RESOLVED" || status === "CLOSED")
    return "border-emerald-300/20 bg-emerald-300/10 text-emerald-200";
  if (status === "IN_PROGRESS")
    return "border-[var(--status-info)]/20 bg-[var(--status-info)]/10 text-[var(--status-info)]";
  return "border-amber-300/20 bg-amber-300/10 text-amber-200";
}

function priorityTone(priority: string) {
  if (priority === "URGENT") return "text-rose-300";
  if (priority === "HIGH") return "text-amber-300";
  if (priority === "LOW") return "text-white/35";
  return "text-[var(--status-info)]";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(type: string) {
  if (type === "application/pdf") return "PDF";
  if (type === "image/png") return "PNG";
  return "JPG";
}

function inferClaimReferenceFromPath(pathname: string): string {
  const claimRouteMatch =
    pathname.match(/^\/claims\/([^/]+)$/) ??
    pathname.match(/^\/claims-advance\/([^/]+)$/);
  return claimRouteMatch?.[1] ? decodeURIComponent(claimRouteMatch[1]) : "";
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SupportPanel() {
  const pathname = usePathname();
  const routeClaimReference = inferClaimReferenceFromPath(pathname);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "CLAIM_ISSUE",
    priority: "MEDIUM" as SupportTicketPriority,
    claim_reference: routeClaimReference,
  });
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: tickets = [], isLoading, mutate } = useSWR<SupportTicket[]>(
    open ? "support-tickets" : null,
    fetchSupportTickets,
    { refreshInterval: open ? 30_000 : 0, revalidateOnFocus: false },
  );

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setForm((prev) => (
      prev.claim_reference || !routeClaimReference
        ? prev
        : { ...prev, claim_reference: routeClaimReference }
    ));
  }, [routeClaimReference]);

  const openCount = tickets.filter(
    (t) => !["RESOLVED", "CLOSED"].includes(t.status),
  ).length;

  // ── Attachment helpers ──────────────────────────────────────────────────────

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    const valid: File[] = [];
    for (const file of incoming) {
      if (!(ATTACHMENT_ACCEPT as readonly string[]).includes(file.type)) {
        toast.error(`"${file.name}" is not allowed. Accepted: PNG, JPG, PDF.`);
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        toast.error(`"${file.name}" exceeds the 5 MB limit.`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;
    setAttachments((prev) => {
      // Deduplicate by name+size
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...valid.filter((f) => !existing.has(`${f.name}:${f.size}`))];
    });
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function onFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    // Reset so the same file can be re-added after removal
    event.target.value = "";
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (event.dataTransfer.files) addFiles(event.dataTransfer.files);
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (form.subject.trim().length < 3 || form.description.trim().length < 5) {
      toast.error("Support ticket needs a subject and issue details");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createSupportTicketWithAttachments(
        {
          ...form,
          subject: form.subject.trim(),
          description: form.description.trim(),
          claim_reference: form.claim_reference.trim(),
          page_route: pathname,
        },
        attachments,
      );
      await mutate([created, ...tickets], false);
      setForm({
        subject: "",
        description: "",
        category: "CLAIM_ISSUE",
        priority: "MEDIUM",
        claim_reference: routeClaimReference,
      });
      setAttachments([]);
      toast.success("Support ticket created", { description: created.subject });
    } catch (err) {
      toast.error("Could not create support ticket", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResolve(ticket: SupportTicket) {
    try {
      const updated = await updateSupportTicketStatus(
        ticket.id,
        "RESOLVED" as SupportTicketStatus,
      );
      await mutate(
        tickets.map((item) => (item.id === updated.id ? updated : item)),
        false,
      );
      toast.success("Ticket marked resolved", { description: updated.subject });
    } catch {
      toast.error("Could not update ticket");
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="relative" ref={panelRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open support"
        aria-expanded={open}
        className="relative flex h-10 items-center gap-2 rounded-full border border-white/5 bg-white/5 px-3 text-white/62 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/10 hover:text-brand-primary active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-bg"
      >
        <LifeBuoy className="h-[17px] w-[17px]" />
        <span className="hidden text-[11px] font-black uppercase tracking-[0.16em] sm:inline">
          Support
        </span>
        {openCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[9px] font-black text-white">
            {openCount > 9 ? "9+" : openCount}
          </span>
        )}
      </button>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-label="Support tickets"
            className="ui-floating-surface absolute right-0 top-full z-50 mt-2 w-[min(92vw,460px)] overflow-hidden rounded-2xl"
          >
            {/* Header */}
            <div className="border-b border-white/[0.06] bg-white/[0.025] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-white">
                    Support Center
                  </p>
                  <p className="mt-1 text-xs leading-5 text-white/42">
                    Create a ticket and track issue status without leaving the workflow.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1 text-white/35 transition hover:bg-white/[0.06] hover:text-white"
                  aria-label="Close support"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid gap-4 p-4">
              {/* ── New ticket form ── */}
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3">
                <div className="grid gap-2">
                  {/* Subject */}
                  <input
                    value={form.subject}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, subject: e.target.value }))
                    }
                    placeholder="Issue subject"
                    className="ui-form-field h-10 text-[13px]"
                    maxLength={140}
                  />

                  {/* Description */}
                  <textarea
                    value={form.description}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="Describe the issue, page, claim reference, or blocker."
                    className="ui-form-field min-h-20 resize-none py-3 text-[13px]"
                    maxLength={2000}
                  />

                  <input
                    value={form.claim_reference}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, claim_reference: e.target.value }))
                    }
                    placeholder="Claim reference (optional)"
                    className="ui-form-field h-10 text-[13px]"
                    maxLength={80}
                  />

                  {/* Category + Priority */}
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={form.category}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, category: e.target.value }))
                      }
                      className="ui-form-field h-10 text-[12px] [color-scheme:dark]"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={form.priority}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          priority: e.target.value as SupportTicketPriority,
                        }))
                      }
                      className="ui-form-field h-10 text-[12px] [color-scheme:dark]"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* ── Attachment drop zone ── */}
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Attach files — PNG, JPG or PDF, max 5 MB each"
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    className={cn(
                      "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60",
                      dragOver
                        ? "border-brand-primary/60 bg-brand-primary/5"
                        : "border-white/[0.1] bg-white/[0.02] hover:border-white/[0.18] hover:bg-white/[0.04]",
                    )}
                  >
                    <Paperclip
                      className={cn(
                        "h-4 w-4 transition-colors",
                        dragOver ? "text-brand-primary" : "text-white/30",
                      )}
                    />
                    <p className="text-[11px] font-semibold text-white/40">
                      {dragOver
                        ? "Drop files here"
                        : "Attach files — PNG, JPG or PDF"}
                    </p>
                    <p className="text-[10px] text-white/24">Max 5 MB per file</p>
                  </div>

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_ATTR}
                    multiple
                    className="sr-only"
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={onFileInputChange}
                  />

                  {/* Attachment list */}
                  {attachments.length > 0 && (
                    <ul className="space-y-1.5" aria-label="Attached files">
                      {attachments.map((file, index) => (
                        <li
                          key={`${file.name}-${file.size}`}
                          className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.04] px-3 py-2"
                        >
                          <span className="flex h-5 w-8 shrink-0 items-center justify-center rounded bg-white/[0.08] text-[8px] font-black uppercase tracking-wider text-white/50">
                            {fileIcon(file.type)}
                          </span>
                          <FileText className="h-3.5 w-3.5 shrink-0 text-white/30" />
                          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white/70">
                            {file.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-white/30">
                            {formatBytes(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAttachment(index);
                            }}
                            aria-label={`Remove ${file.name}`}
                            className="ml-1 rounded p-0.5 text-white/30 transition hover:bg-white/[0.06] hover:text-rose-400"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Submit */}
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="ui-button-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest disabled:opacity-50"
                  >
                    {submitting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Create Ticket
                    {attachments.length > 0 && (
                      <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-black">
                        {attachments.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* ── Ticket list ── */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/34">
                    My Tickets
                  </p>
                  <span className="rounded-full border border-white/[0.06] bg-white/[0.04] px-2 py-1 text-[9px] font-black text-white/36">
                    {tickets.length} total
                  </span>
                </div>
                <div className="custom-scrollbar max-h-72 space-y-2 overflow-y-auto pr-1">
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/35">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading tickets
                    </div>
                  ) : tickets.length === 0 ? (
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-8 text-center">
                      <Headphones className="mx-auto h-7 w-7 text-white/18" />
                      <p className="mt-3 text-xs font-bold text-white/34">
                        No support tickets yet.
                      </p>
                    </div>
                  ) : (
                    tickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-white/82">
                              {ticket.subject}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/42">
                              {ticket.description}
                            </p>
                            {(ticket.claim_reference || ticket.page_route) && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.12em]">
                                {ticket.claim_reference && (
                                  (() => {
                                    const href = getSupportTicketClaimHref(ticket);
                                    return href ? (
                                      <Link
                                        href={href}
                                        className="rounded-full border border-[var(--status-info)]/15 bg-[var(--status-info)]/10 px-2 py-1 text-[var(--status-info)] hover:border-[var(--status-info)]/35"
                                      >
                                        {ticket.claim_reference}
                                      </Link>
                                    ) : (
                                      <span className="rounded-full border border-[var(--status-info)]/15 bg-[var(--status-info)]/10 px-2 py-1 text-[var(--status-info)]">
                                        {ticket.claim_reference}
                                      </span>
                                    );
                                  })()
                                )}
                                {ticket.page_route && (
                                  <span className="text-white/24">{ticket.page_route}</span>
                                )}
                              </div>
                            )}
                          </div>
                          <TicketCheck className="h-4 w-4 shrink-0 text-brand-primary/80" />
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em]",
                              statusTone(ticket.status),
                            )}
                          >
                            {ticket.status.replace(/_/g, " ")}
                          </span>
                          <span
                            className={cn(
                              "text-[9px] font-black uppercase tracking-[0.14em]",
                              priorityTone(ticket.priority),
                            )}
                          >
                            {ticket.priority}
                          </span>
                          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-white/26">
                            {ticket.category.replace(/_/g, " ")}
                          </span>

                          {/* Attachment count badge */}
                          {ticket.attachments && ticket.attachments.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {ticket.attachments.map((file) => (
                                <a
                                  key={file}
                                  href={getSupportTicketAttachmentHref(ticket.id, file)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] px-2 py-1 text-[9px] font-semibold text-white/36 hover:border-white/[0.16] hover:text-white/72"
                                >
                                  <Paperclip className="h-2.5 w-2.5" />
                                  {file}
                                </a>
                              ))}
                            </div>
                          )}

                          {!["RESOLVED", "CLOSED"].includes(ticket.status) && (
                            <button
                              type="button"
                              onClick={() => handleResolve(ticket)}
                              className="ml-auto inline-flex items-center gap-1 rounded-full border border-emerald-300/15 bg-emerald-300/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-200 transition hover:border-emerald-300/30"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Resolve
                            </button>
                          )}
                        </div>
                        {ticket.resolution_notes && (
                          <p className="mt-2 text-[11px] leading-5 text-white/42">
                            {ticket.resolution_notes}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
