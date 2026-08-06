"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  UserPlus, Pencil, KeyRound, Trash2, CheckCircle2, XCircle,
  Loader2, AlertCircle, RefreshCw, Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAdminUsers } from "@/lib/hooks/useAdminUsers";
import { adminDeleteUser } from "@/lib/api";
import type { AdminUser } from "@/lib/types";
import { UserFormDialog } from "./UserFormDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import MFAResetDialog from "@/app/admin/users/mfa-reset-dialog";

const ROLE_COLORS: Record<string, string> = {
  ADMIN:              "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  ADJUSTER:           "bg-blue-500/15 text-blue-400 border-blue-500/30",
  SENIOR_ADJUSTER:    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MEDICAL_DIRECTOR:   "bg-violet-500/15 text-violet-400 border-violet-500/30",
  COMPLIANCE_OFFICER: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  API_CONSUMER:       "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export function UsersTab() {
  const { users, error, isLoading, refresh } = useAdminUsers();
  const [formOpen, setFormOpen]         = useState(false);
  const [editUser, setEditUser]         = useState<AdminUser | null>(null);
  const [resetUser, setResetUser]       = useState<AdminUser | null>(null);
  const [mfaResetUser, setMfaResetUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting]         = useState(false);

  function openCreate() { setEditUser(null); setFormOpen(true); }
  function openEdit(u: AdminUser) { setEditUser(u); setFormOpen(true); }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminDeleteUser(deleteTarget.email);
      toast.success(`User ${deleteTarget.email} deleted`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="dashboard-panel overflow-hidden">
        <div className="dashboard-panel-accent bg-gradient-to-r from-cyan-300/0 via-cyan-300/42 to-transparent" />
        <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="ui-eyebrow text-white/30">User Access</p>
            <h3 className="mt-2 text-[1.05rem] font-bold text-white">Identity and access directory</h3>
          </div>
          <Button
            size="sm"
            onClick={openCreate}
            className="gap-1.5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 text-cyan-100 shadow-none hover:border-cyan-300/30 hover:bg-cyan-300/16"
          >
          <UserPlus className="h-3.5 w-3.5" />
          New User
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="dashboard-panel px-4 py-4">
          <p className="ui-eyebrow text-white/30">Directory Size</p>
          <p className="mt-2 text-2xl font-black text-white">{users.length}</p>
          <p className="mt-1 text-xs text-white/42">Managed user identities.</p>
        </div>
        <div className="dashboard-panel px-4 py-4">
          <p className="ui-eyebrow text-white/30">Admins</p>
          <p className="mt-2 text-2xl font-black text-white">{users.filter((u) => u.role === "ADMIN").length}</p>
          <p className="mt-1 text-xs text-white/42">Privileged control-plane access.</p>
        </div>
        <div className="dashboard-panel px-4 py-4">
          <p className="ui-eyebrow text-white/30">MFA Enforced</p>
          <p className="mt-2 text-2xl font-black text-white">{users.filter((u) => u.mfa_required).length}</p>
          <p className="mt-1 text-xs text-white/42">Accounts requiring second factor.</p>
        </div>
        <div className="dashboard-panel px-4 py-4">
          <p className="ui-eyebrow text-white/30">Inactive Users</p>
          <p className="mt-2 text-2xl font-black text-white">{users.filter((u) => !u.is_active).length}</p>
          <p className="mt-1 text-xs text-white/42">Disabled or suspended accounts.</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-white/38">
          Directory management and recovery actions
        </p>
      </div>

      {/* Error banner */}
      {error && !isLoading && (
        <Alert variant="destructive" className="border-red-400/14 bg-red-400/[0.08] text-red-100">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Failed to load users: {error instanceof Error ? error.message : "Unknown error"}</span>
            <Button variant="outline" size="sm" onClick={() => refresh()} className="ml-3 gap-1.5 shrink-0 rounded-xl border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/[0.08]">
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="dashboard-panel flex items-center justify-center gap-2 py-10 text-sm text-white/42">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading users…
        </div>
      ) : (
        <div className="dashboard-panel overflow-hidden rounded-[1.5rem]">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-white/[0.04]">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-white/32">Name / Email</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-white/32">Role</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-white/32">Region</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-white/32">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-widest text-white/32">MFA Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-widest text-white/32">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {users.map((u) => (
                <tr key={u.email} className="transition-colors hover:bg-white/[0.025]">
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{u.full_name}</p>
                    <p className="text-xs text-white/40">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${ROLE_COLORS[u.role] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {u.role.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white/58">{u.market_region}</td>
                  <td className="px-4 py-3">
                    {u.is_active ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-400">
                        <XCircle className="h-3.5 w-3.5" /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.mfa_required ? (
                      u.mfa_enabled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-300">
                          <AlertCircle className="h-3.5 w-3.5" /> Required - Not Set
                        </span>
                      )
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-white/32">
                        <XCircle className="h-3.5 w-3.5" /> Optional
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-white/62 hover:bg-white/[0.08] hover:text-white"
                        onClick={() => openEdit(u)}
                        title="Edit user"
                        aria-label={`Edit user ${u.email}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-white/62 hover:bg-white/[0.08] hover:text-white"
                        onClick={() => setResetUser(u)}
                        title="Reset password"
                        aria-label={`Reset password for ${u.email}`}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {u.mfa_required && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-cyan-400 hover:bg-[var(--status-info)]/10 hover:text-[var(--status-info)]"
                          onClick={() => setMfaResetUser(u)}
                          title="Reset MFA"
                          aria-label={`Reset MFA for ${u.email}`}
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                        onClick={() => setDeleteTarget(u)}
                        title="Delete user"
                        aria-label={`Delete user ${u.email}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <UserFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editUser={editUser}
        onSuccess={() => { setFormOpen(false); refresh(); }}
      />

      <ResetPasswordDialog
        open={!!resetUser}
        user={resetUser}
        onOpenChange={(o) => { if (!o) setResetUser(null); }}
        onSuccess={() => setResetUser(null)}
      />

      <MFAResetDialog
        isOpen={!!mfaResetUser}
        email={mfaResetUser?.email || ""}
        onClose={() => setMfaResetUser(null)}
        onSuccess={() => { setMfaResetUser(null); refresh(); }}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.email}</strong>. They will no longer be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-500 focus:ring-rose-500"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
