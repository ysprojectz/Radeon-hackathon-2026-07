"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  X,
  CheckCheck,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import useSWR from "swr";
import { getClaims } from "@/lib/api";
import type { ClaimListResponse } from "@/lib/types";
import { motion } from "motion/react";

// ─── localStorage helpers ────────────────────────────────────────────────────

const LS_KEY = "notif_last_read_at";
const LS_DISMISSED_KEY = "notif_dismissed_ids";

export function getNotifLastReadAt(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(LS_KEY) ?? "0", 10);
}

export function saveNotifLastReadAt(ts: number): void {
  if (typeof window !== "undefined") localStorage.setItem(LS_KEY, ts.toString());
}

export function getDismissedNotifications(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(LS_DISMISSED_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
  } catch {
    return new Set();
  }
}

export function saveDismissedNotifications(dismissed: Set<string>): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(LS_DISMISSED_KEY, JSON.stringify(Array.from(dismissed)));
  }
}

export function dismissNotification(id: string): void {
  const dismissed = getDismissedNotifications();
  dismissed.add(id);
  saveDismissedNotifications(dismissed);
}

export function clearDismissedNotifications(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LS_DISMISSED_KEY);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type NotifType = "settled" | "denied" | "review";

export interface NotifItem {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  href: string;
  ts: number; // unix ms
}

// ─── Derive notifications from recent claims only ───────────────────────────

export function deriveNotifications(
  claims: ClaimListResponse | undefined
): NotifItem[] {
  const out: NotifItem[] = [];
  const now = Date.now();
  const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h

  if (claims?.claims) {
    for (const c of claims.claims) {
      const adjTs = c.date_adjudicated
        ? new Date(c.date_adjudicated).getTime()
        : 0;
      if (!adjTs || now - adjTs > WINDOW_MS) continue;

      if (c.status === "SETTLED" || c.status === "HITL_APPROVED") {
        const amt = c.total_settlement ?? c.total_billed;
        out.push({
          id: `${c.status.toLowerCase()}-${c.id}`,
          type: "settled",
          title: c.status === "HITL_APPROVED"
            ? `${c.claim_reference} approved after review`
            : `${c.claim_reference} settled`,
          body: `${c.patient_name} · ${c.currency} ${Number(amt).toLocaleString()}`,
          href: `/claims/${c.claim_reference}`,
          ts: adjTs,
        });
      } else if (c.status === "DENIED" || c.status === "HITL_DENIED") {
        out.push({
          id: `${c.status.toLowerCase()}-${c.id}`,
          type: "denied",
          title: c.status === "HITL_DENIED"
            ? `${c.claim_reference} rejected after review`
            : `${c.claim_reference} denied`,
          body: `${c.patient_name} · ${c.provider_name}`,
          href: `/claims/${c.claim_reference}`,
          ts: adjTs,
        });
      } else if (c.status === "HITL_PENDING") {
        out.push({
          id: `hitl_pending-${c.id}`,
          type: "review",
          title: `${c.claim_reference} needs reviewer action`,
          body: `${c.patient_name} · ${c.provider_name}`,
          href: `/claims/${c.claim_reference}`,
          ts: adjTs,
        });
      }
    }
  }

  return out.sort((a, b) => b.ts - a.ts);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Icons & colours per type ─────────────────────────────────────────────────

const TYPE_ICON: Record<NotifType, React.ReactNode> = {
  settled: <CheckCircle2 className="w-4 h-4 text-green-400" />,
  denied:  <XCircle    className="w-4 h-4 text-red-400" />,
  review:  <Loader2    className="w-4 h-4 text-amber-400" />,
};

const TYPE_BG: Record<NotifType, string> = {
  settled: "dark:bg-green-500/10 bg-green-50",
  denied:  "dark:bg-red-500/10   bg-red-50",
  review:  "dark:bg-amber-500/10 bg-amber-50",
};

// ─── Component ───────────────────────────────────────────────────────────────

export interface NotificationPanelProps {
  open: boolean;
  lastReadAt: number;
  onMarkAllRead: () => void;
  onClose: () => void;
  dismissedIds?: Set<string>;
  onDismiss?: (id: string) => void;
  onClearAll?: (ids: string[]) => void;
}

export function NotificationPanel({
  open,
  lastReadAt,
  onMarkAllRead,
  onClose,
  dismissedIds = new Set(),
  onDismiss,
  onClearAll,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const { data: claims, isLoading: claimsLoading } = useSWR<ClaimListResponse>(
    open ? "notif-recent-claims" : null,
    () => getClaims({ page_size: 50 }),
    { refreshInterval: open ? 60_000 : 0, revalidateOnFocus: false }
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const loading = claimsLoading;
  const allNotifications = deriveNotifications(claims);
  const notifications = allNotifications.filter((n) => !dismissedIds.has(n.id));
  const unreadCount = notifications.filter((n) => n.ts > lastReadAt).length;

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-label="Notifications"
      className={cn(
        "ui-floating-surface absolute right-0 top-full z-50 mt-2 w-96 overflow-hidden rounded-2xl"
      )}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 dark:border-white/5 border-slate-100 border-b dark:bg-white/[0.02] bg-slate-50">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold dark:text-white text-slate-900">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold dark:text-slate-400 dark:hover:text-cyan-400 text-slate-500 hover:text-cyan-600 transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={() => onClearAll?.(notifications.map((n) => n.id))}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold dark:text-slate-400 dark:hover:text-red-400 text-slate-500 hover:text-red-500 transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-h-[420px] overflow-y-auto">
        {loading && notifications.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 dark:text-slate-500 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <div className="w-10 h-10 rounded-full dark:bg-white/5 bg-slate-100 flex items-center justify-center">
              <CheckCheck className="w-5 h-5 dark:text-slate-600 text-slate-300" />
            </div>
            <p className="text-sm dark:text-slate-500 text-slate-400">All caught up!</p>
            <p className="text-xs dark:text-slate-600 text-slate-300">No new notifications.</p>
          </div>
        ) : (
          <ul role="list">
            {notifications.map((n) => {
              const isUnread = n.ts > lastReadAt;
              return (
                <li key={n.id} className="border-b dark:border-white/[0.04] border-slate-100 last:border-0 group">
                  <div className="flex items-start gap-3 px-5 py-3 relative">
                    <Link
                      href={n.href}
                      onClick={onClose}
                      className={cn(
                        "flex items-start gap-3 flex-1 min-w-0 transition-colors rounded-lg -mx-5 px-5 -my-3 py-3",
                        "dark:hover:bg-white/[0.04] hover:bg-slate-50",
                        isUnread && "dark:bg-cyan-500/[0.04] bg-blue-50/50"
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                          TYPE_BG[n.type]
                        )}
                      >
                        {TYPE_ICON[n.type]}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-xs font-semibold",
                            isUnread
                              ? "dark:text-white text-slate-900"
                              : "dark:text-slate-300 text-slate-700"
                          )}
                        >
                          {n.title}
                        </p>
                        <p className="text-[11px] dark:text-slate-500 text-slate-400 mt-0.5">
                          {n.body}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
                        <span className="text-[10px] dark:text-slate-600 text-slate-400 whitespace-nowrap">
                          {timeAgo(n.ts)}
                        </span>
                        {isUnread && (
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 shadow-[0_0_6px_rgba(6,182,212,0.7)]" />
                        )}
                      </div>
                    </Link>

                    {/* Dismiss button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDismiss?.(n.id);
                      }}
                      className={cn(
                        "absolute top-3 right-5 p-1 rounded-md opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                        "dark:hover:bg-white/10 hover:bg-slate-200",
                        "dark:text-slate-500 text-slate-400 hover:text-slate-700 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                      )}
                      aria-label="Dismiss notification"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </motion.div>
  );
}
