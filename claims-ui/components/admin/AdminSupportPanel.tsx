"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { Headphones, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  getSupportTicketAttachmentHref,
  getSupportTicketClaimHref,
  type SupportTicket,
  type SupportTicketStatus,
} from "@/lib/support";

const STATUSES: SupportTicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"];

function statusTone(status: string) {
  if (status === "RESOLVED" || status === "CLOSED") return "bg-emerald-500/10 text-emerald-300 border-emerald-300/20";
  if (status === "IN_PROGRESS") return "bg-cyan-500/10 text-cyan-300 border-cyan-300/20";
  return "bg-amber-500/10 text-amber-300 border-amber-300/20";
}

function priorityTone(priority: string) {
  if (priority === "URGENT") return "text-rose-300";
  if (priority === "HIGH") return "text-amber-300";
  if (priority === "LOW") return "text-white/40";
  return "text-cyan-200";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const proxyPath = `/api/v1/proxy${path.replace(/^\/api\/v1/, "")}`;
  const res = await fetch(proxyPath, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.clone().json();
      detail = typeof body?.detail === "string" ? body.detail : typeof body?.error === "string" ? body.error : undefined;
    } catch {
      // ignore parse failures
    }
    throw new Error(detail ?? `Support admin request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export default function AdminSupportPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const openCount = useMemo(
    () => tickets.filter((ticket) => !["RESOLVED", "CLOSED"].includes(ticket.status)).length,
    [tickets]
  );

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (searchFilter.trim()) params.set("search", searchFilter.trim());
      const data = await apiRequest<SupportTicket[]>(`/api/v1/admin/support/tickets?${params.toString()}`);
      setTickets(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load support tickets.");
    } finally {
      setLoading(false);
    }
  }, [priorityFilter, searchFilter, statusFilter]);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
        return;
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    if (!checking) void loadTickets();
  }, [checking, loadTickets]);

  async function updateStatus(ticket: SupportTicket, status: SupportTicketStatus, resolutionNotes?: string) {
    setUpdatingId(ticket.id);
    try {
      const updated = await apiRequest<SupportTicket>(`/api/v1/admin/support/tickets/${ticket.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          resolution_notes: resolutionNotes ?? noteDrafts[ticket.id] ?? ticket.resolution_notes ?? "",
        }),
      });
      setTickets((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNoteDrafts((current) => ({ ...current, [ticket.id]: updated.resolution_notes ?? "" }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update ticket status.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (checking) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Support Ticket Management"
        actions={
          <Button onClick={loadTickets} disabled={loading} className="h-9 gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border border-white/10 glass-card p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Open Work</p>
          <p className="mt-2 text-3xl font-bold text-white">{openCount}</p>
        </Card>
        <Card className="border border-white/10 glass-card p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Total Tickets</p>
          <p className="mt-2 text-3xl font-bold text-white">{tickets.length}</p>
        </Card>
        <Card className="border border-white/10 glass-card p-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Urgent / High</p>
          <p className="mt-2 text-3xl font-bold text-white">
            {tickets.filter((ticket) => ["URGENT", "HIGH"].includes(ticket.priority)).length}
          </p>
        </Card>
      </div>

      <Card className="border border-white/10 glass-card p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={searchFilter}
            onChange={(event) => setSearchFilter(event.target.value)}
            placeholder="Search requester, subject, description, or claim reference"
            className="h-9 max-w-sm border-white/10 bg-black/40 text-sm"
          />
          <Select value={statusFilter || "__ALL__"} onValueChange={(value) => setStatusFilter(value === "__ALL__" ? "" : value)}>
            <SelectTrigger className="h-9 w-40 border-white/10 bg-black/40 text-sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All statuses</SelectItem>
              {STATUSES.map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter || "__ALL__"} onValueChange={(value) => setPriorityFilter(value === "__ALL__" ? "" : value)}>
            <SelectTrigger className="h-9 w-40 border-white/10 bg-black/40 text-sm">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__ALL__">All priorities</SelectItem>
              {PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-white/75">Ticket</TableHead>
                <TableHead className="text-white/75">Requester</TableHead>
                <TableHead className="text-white/75">Priority</TableHead>
                <TableHead className="text-white/75">Status</TableHead>
                <TableHead className="text-white/75">Updated</TableHead>
                <TableHead className="text-right text-white/75">Resolution</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow className="border-white/5">
                  <TableCell colSpan={6} className="py-12 text-center text-white/45">
                    <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                    Loading support tickets
                  </TableCell>
                </TableRow>
              ) : tickets.length === 0 ? (
                <TableRow className="border-white/5">
                  <TableCell colSpan={6} className="py-12 text-center text-white/45">
                    <Headphones className="mx-auto mb-3 h-7 w-7 text-white/20" />
                    No support tickets match this view.
                  </TableCell>
                </TableRow>
              ) : tickets.map((ticket) => (
                <TableRow key={ticket.id} className="border-white/5 align-top hover:bg-white/[0.03]">
                  <TableCell>
                    <p className="max-w-md font-semibold text-white/86">{ticket.subject}</p>
                    <p className="mt-1 max-w-lg text-xs leading-5 text-white/42">{ticket.description}</p>
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/28">{ticket.category.replace(/_/g, " ")}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {ticket.claim_reference && (
                        (() => {
                          const href = getSupportTicketClaimHref(ticket);
                          return href ? (
                            <Link
                              href={href}
                              className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200 hover:border-cyan-300/35"
                            >
                              {ticket.claim_reference}
                            </Link>
                          ) : (
                            <span className="rounded-full border border-cyan-300/15 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200">
                              {ticket.claim_reference}
                            </span>
                          );
                        })()
                      )}
                      {ticket.market_region && (
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/28">
                          {ticket.market_region}
                        </span>
                      )}
                      {ticket.page_route && (
                        <span className="text-[10px] text-white/28">{ticket.page_route}</span>
                      )}
                    </div>
                    {ticket.attachments && ticket.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {ticket.attachments.map((file) => (
                          <a
                            key={file}
                            href={getSupportTicketAttachmentHref(ticket.id, file, { admin: true })}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-white/45 hover:border-white/[0.16] hover:text-white/75"
                          >
                            <Paperclip className="h-3 w-3" />
                            {file}
                          </a>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-white/65">{ticket.created_by}</TableCell>
                  <TableCell className={`text-xs font-black uppercase tracking-[0.14em] ${priorityTone(ticket.priority)}`}>
                    {ticket.priority}
                  </TableCell>
                  <TableCell>
                    <Badge className={`border ${statusTone(ticket.status)}`}>{ticket.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-white/55">
                    {format(new Date(ticket.updated_at), "MMM d, yyyy h:mm a")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="ml-auto flex w-64 flex-col gap-2">
                      <Select
                        value={ticket.status}
                        disabled={updatingId === ticket.id}
                        onValueChange={(value) => updateStatus(ticket, value as SupportTicketStatus)}
                      >
                        <SelectTrigger className="ml-auto h-8 w-full border-white/10 bg-black/40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((status) => <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Textarea
                        value={noteDrafts[ticket.id] ?? ticket.resolution_notes ?? ""}
                        onChange={(event) => setNoteDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))}
                        placeholder="Resolution notes"
                        className="min-h-20 border-white/10 bg-black/40 text-xs"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={updatingId === ticket.id}
                        className="ml-auto h-8 border-white/10 bg-white/[0.03] text-xs text-white/75 hover:bg-white/[0.06]"
                        onClick={() => updateStatus(ticket, ticket.status as SupportTicketStatus)}
                      >
                        Save Notes
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
