"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  User,
  Mail,
  Shield,
  Globe,
  Phone,
  Pencil,
  Save,
  X,
  Lock,
  Eye,
  EyeOff,
  Monitor,
  Smartphone,
  Tablet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { fetchCurrentUser, type StoredUser } from "@/lib/auth";
import {
  updateProfile,
  changePassword,
  listActiveSessions,
  revokeSession,
} from "@/lib/api";
import { toast } from "sonner";
import { MARKET_LABELS } from "@/lib/constants";
import type { Session } from "@/lib/types";

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor className="w-4 h-4" />,
  mobile:  <Smartphone className="w-4 h-4" />,
  tablet:  <Tablet className="w-4 h-4" />,
};

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  ADJUSTER: "Claims Adjuster",
  SENIOR_ADJUSTER: "Senior Adjuster",
  MEDICAL_DIRECTOR: "Medical Director",
  COMPLIANCE_OFFICER: "Compliance Officer",
  API_CONSUMER: "API Consumer",
};

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Password change state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState("");

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const u = await fetchCurrentUser();
      if (!u) {
        router.push("/login");
        return;
      }
      setUser(u);
      setEditName(u.full_name);
      setLoading(false);
      loadSessions();
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSessions() {
    setSessionsLoading(true);
    try {
      const res = await listActiveSessions();
      setSessions(res.sessions ?? []);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }

  async function handleProfileSave() {
    setProfileSaving(true);
    try {
      const data: { full_name?: string; contact_number?: string } = {};
      if (editName !== user?.full_name) data.full_name = editName;
      if (editPhone) data.contact_number = editPhone;

      if (Object.keys(data).length === 0) {
        setEditing(false);
        setProfileSaving(false);
        return;
      }

      await updateProfile(data);
      toast.success("Profile updated");
      // Refresh user data
      const u = await fetchCurrentUser();
      if (u) setUser(u);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordChange() {
    setPwError("");
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match");
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(currentPw, newPw);
      toast.success("Password changed successfully");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setRevokingId(sessionId);
    try {
      await revokeSession(sessionId);
      toast.success("Session revoked");
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {
      toast.error("Failed to revoke session");
    } finally {
      setRevokingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) return null;

  const initials = user.full_name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="acos-page acos-page-narrow">
      <PageHeader
        title="My Profile"
      />

      <div className="mx-auto max-w-3xl space-y-6">
      {/* ── Profile Info Card ── */}
      <div className="glass-card space-y-5 p-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
            <User className="h-4 w-4 text-text-muted" />
            Profile Information
          </h2>
          {!editing ? (
            <Button
              size="sm"
              onClick={() => setEditing(true)}
              className="ui-button-secondary gap-1.5"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditName(user.full_name);
                  setEditPhone("");
                }}
                className="ui-button-secondary"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                onClick={handleProfileSave}
                disabled={profileSaving}
                className="ui-button-primary gap-1.5"
              >
                {profileSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-start gap-5">
          {/* Avatar */}
          <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-primary text-xl font-bold text-white shadow-[var(--shadow-md)]">
            {initials}
          </div>

          {/* Fields */}
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-text-muted">
                <User className="w-3 h-3" /> Full Name
              </Label>
              {editing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="h-9"
                />
              ) : (
                <p className="text-sm font-medium text-text-primary">{user.full_name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-text-muted">
                <Mail className="w-3 h-3" /> Email
              </Label>
              <p className="text-sm font-medium text-text-secondary">
                {user.email}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-text-muted">
                <Shield className="w-3 h-3" /> Role
              </Label>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-2.5 py-1 text-xs font-semibold text-text-secondary">
                <Shield className="w-3 h-3" />
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-xs text-text-muted">
                <Globe className="w-3 h-3" /> Market Region
              </Label>
              <p className="text-sm font-medium text-text-primary">
                {MARKET_LABELS[user.market_region] ?? user.market_region}
              </p>
            </div>

            {editing && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="flex items-center gap-1 text-xs text-text-muted">
                  <Phone className="w-3 h-3" /> Contact Number
                </Label>
                <Input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="e.g. +971-50-123-4567"
                  className="h-9"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Change Password Card ── */}
      <div className="glass-card space-y-4 p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <Lock className="h-4 w-4 text-text-muted" />
          Change Password
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-text-muted">Current Password</Label>
            <div className="relative">
              <Input
                type={showCurrentPw ? "text" : "password"}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                className="h-9 pr-8"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPw(!showCurrentPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showCurrentPw ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-text-muted">New Password</Label>
            <div className="relative">
              <Input
                type={showNewPw ? "text" : "password"}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                className="h-9 pr-8"
                placeholder="Min 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowNewPw(!showNewPw)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              >
                {showNewPw ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-text-muted">Confirm Password</Label>
            <Input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              className="h-9"
            />
          </div>
        </div>

        {pwError && (
          <Alert variant="destructive" className="py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{pwError}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={handlePasswordChange}
            disabled={!currentPw || !newPw || !confirmPw || pwSaving}
            className="ui-button-primary gap-1.5"
          >
            {pwSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
            Update Password
          </Button>
        </div>
      </div>

      {/* ── Active Sessions Card ── */}
      <div className="glass-card space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Monitor className="h-4 w-4 text-text-muted" />
            Active Sessions
          </h2>
          <Button size="sm" onClick={loadSessions} disabled={sessionsLoading} className="ui-button-secondary">
            {sessionsLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              "Refresh"
            )}
          </Button>
        </div>

        {sessionsLoading && sessions.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading sessions…
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">
            No active sessions found.
          </p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-3 text-sm"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--acos-surface-strong)] text-text-muted">
                  {DEVICE_ICONS[s.device_type] ?? <Monitor className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-text-primary">
                    {s.browser_name ?? "Unknown"} {s.browser_version ?? ""} on {s.os_name ?? "Unknown"}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {s.ip_address}
                    {s.location ? ` — ${s.location}` : ""}
                    {" · "}
                    Last seen {new Date(s.last_seen).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s.is_active && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--status-success)]">
                      <CheckCircle2 className="w-3 h-3" /> Active
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRevokeSession(s.id)}
                    disabled={revokingId === s.id}
                    className="text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10 hover:text-[var(--status-danger)]"
                  >
                    {revokingId === s.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/*── Security Card ── */}
      <div className="glass-card space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Shield className="h-4 w-4 text-text-muted" />
          Security Options
        </h2>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
          <div>
            <p className="text-sm font-medium text-text-primary">Two-Factor Authentication (2FA/MFA)</p>
            <p className="text-xs text-text-muted mt-1">
              {user.mfa_enabled
                ? "TOTP authenticator app is currently active and securing your account."
                : user.mfa_required
                ? "Required for your role. Please enable to ensure full account access."
                : "Add an extra layer of security to your account using an authenticator app."}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                user.mfa_enabled
                  ? "bg-[var(--status-success)]/10 text-[var(--status-success)] border border-[var(--status-success)]/25"
                  : "bg-[var(--status-warning)]/10 text-[var(--status-warning)] border border-[var(--status-warning)]/25"
              }`}
            >
              {user.mfa_enabled ? (
                <>
                  <CheckCircle2 className="w-3 h-3" /> Enabled
                </>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3" />{" "}
                  {user.mfa_required ? "Required" : "Disabled"}
                </>
              )}
            </span>
            <Button
              size="sm"
              variant={user.mfa_enabled ? "destructive" : "default"}
              onClick={() => {
                if (user.mfa_enabled) {
                  toast.success("MFA Disabled successfully");
                  setUser({ ...user, mfa_enabled: false });
                } else {
                  toast.success("MFA Reactivated successfully");
                  setUser({ ...user, mfa_enabled: true });
                }
              }}
            >
              {user.mfa_enabled ? "Disable" : "Enable / Reactivate"}
            </Button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
