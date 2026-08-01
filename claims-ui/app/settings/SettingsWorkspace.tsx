"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Clock3,
  LogOut,
  Shield,
  Smartphone,
  Sparkles,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveSessions } from "@/hooks/useActiveSessions";
import { toast } from "sonner";
import TwoFactorSettingsPage from "./two-factor";
import { AdminConfigurationWorkspace } from "@/components/admin/AdminConfigurationWorkspace";
import { AdminCanonicalWorkspace } from "@/components/admin/AdminCanonicalWorkspace";
import type { DashboardKPIs } from "@/lib/types";

type SettingsTab = "security" | "sessions" | "mfa" | "master-settings" | "admin-console";

const PERSONAL_TABS: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: "security",
    label: "Security",
    description: "Account posture and recovery settings",
    icon: Shield,
  },
  {
    id: "sessions",
    label: "Active Sessions",
    description: "Signed-in devices and recent activity",
    icon: Smartphone,
  },
  {
    id: "mfa",
    label: "Two-Factor",
    description: "Authenticator and backup code controls",
    icon: Sparkles,
  },
];

const ADMIN_TABS: Array<{
  id: SettingsTab;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  {
    id: "master-settings",
    label: "Master Settings",
    description: "Users, auth, AI, rules and system configuration",
    icon: Settings2,
  },
  {
    id: "admin-console",
    label: "Admin Console",
    description: "Policies, audit, integrations and operations",
    icon: ShieldCheck,
  },
];

// Deep-link support: /admin and /master-settings redirect here with
// ?section=admin-console / ?section=master-settings so old bookmarks land on
// the right top-level tab (any #hash from the original URL is preserved by
// the browser through the redirect and read independently by
// AdminCanonicalWorkspace's own internal sub-tab navigation).
function readInitialSection(isAdmin: boolean): SettingsTab {
  if (typeof window === "undefined") return "security";
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  if (isAdmin && (section === "master-settings" || section === "admin-console")) {
    return section;
  }
  return "security";
}

export function SettingsWorkspace({
  isAdmin,
  initialKPIs,
}: {
  isAdmin: boolean;
  initialKPIs?: DashboardKPIs | null;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("security");
  const [revokeLoading, setRevokeLoading] = useState<string | null>(null);
  const { sessions, isLoading, error: sessionsError, revoke } = useActiveSessions();

  // Resolve the initial tab from ?section= once mounted (client-only, since
  // it depends on window.location — same pattern AdminCanonicalWorkspace
  // already uses for its own #hash routing).
  useEffect(() => {
    setActiveTab(readInitialSection(isAdmin));
  }, [isAdmin]);

  const tabs = isAdmin ? [...PERSONAL_TABS, ...ADMIN_TABS] : PERSONAL_TABS;
  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  async function handleRevokeSession(sessionId: string) {
    setRevokeLoading(sessionId);
    try {
      await revoke(sessionId);
      toast.success("Session revoked");
    } catch {
      toast.error("Failed to revoke session");
    } finally {
      setRevokeLoading(null);
    }
  }

  const currentSessionId = sessions[0]?.id;
  const isAdminSection = activeTab === "master-settings" || activeTab === "admin-console";

  return (
    <section className="dashboard-panel overflow-hidden mt-4">
      <div className="dashboard-panel-accent bg-brand-primary/30" />

      <div className="relative flex flex-col gap-6 p-5 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <div className="space-y-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200",
                      isActive
                        ? "border-brand-primary/30 bg-brand-primary/10 shadow-sm"
                        : "border-[var(--border-subtle)] bg-transparent hover:border-[var(--border-strong)] hover:bg-[var(--acos-surface)]"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border",
                          isActive
                            ? "border-brand-primary/30 bg-brand-primary/15 text-brand-primary"
                            : "border-[var(--border-subtle)] bg-[var(--acos-surface)] text-[var(--text-muted)]"
                        )}
                      >
                        <Icon size={17} />
                      </div>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-semibold", isActive ? "text-brand-primary" : "text-[var(--text-primary)]")}>
                          {tab.label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                          {tab.description}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="min-w-0 space-y-4">
            {!isAdminSection && (
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="ui-eyebrow">Configuration Module</p>
                    <h2 className="mt-2 text-[1.02rem] font-bold text-[var(--text-primary)] sm:text-[1.1rem]">
                      {currentTab.label}
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-2.5">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        Sessions
                      </p>
                      <p className="mt-1 font-mono text-lg font-black text-[var(--text-primary)]">
                        {sessions.length}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-2.5">
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                        Focus
                      </p>
                      <p className="mt-1 truncate text-sm font-black text-brand-primary">
                        {currentTab.label}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="grid gap-4">
                <section className="dashboard-panel overflow-hidden">
                  <div className="dashboard-panel-accent bg-brand-primary/25" />
                  <div className="relative flex h-full flex-col gap-5 p-5">
                    <div className="dashboard-panel-header">
                      <div className="dashboard-panel-title">
                        <span className="dashboard-panel-dot bg-brand-primary" />
                        <p className="dashboard-panel-label">Account Security</p>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--text-muted)]">
                        Current Protection
                      </p>
                      <p className="mt-2 text-base font-semibold text-[var(--text-primary)]">
                        Password authentication with optional multi-factor verification.
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                        Review your authenticator setup, keep backup access available, and monitor active sessions from one place.
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Sign-In Layer
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text-secondary)]">Password</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          MFA Controls
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text-secondary)]">Available</p>
                      </div>
                      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-4 py-3">
                        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                          Device Review
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--text-secondary)]">Session audit</p>
                      </div>
                    </div>

                    <div className="mt-auto flex flex-wrap gap-3">
                      <button
                        onClick={() => setActiveTab("mfa")}
                        className="rounded-xl border border-brand-primary/30 bg-brand-primary/10 px-4 py-2.5 text-sm font-semibold text-brand-primary transition-colors hover:bg-brand-primary/15"
                      >
                        Manage Two-Factor Authentication
                      </button>
                      <button
                        onClick={() => setActiveTab("sessions")}
                        className="rounded-xl border border-[var(--border-subtle)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--acos-surface)] hover:text-[var(--text-primary)]"
                      >
                        Review Active Sessions
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === "sessions" && (
              <div className="space-y-4">
                <section className="dashboard-panel overflow-hidden">
                  <div className="dashboard-panel-accent bg-brand-primary/25" />
                  <div className="relative flex flex-col gap-4 p-5">
                    <div className="dashboard-panel-header">
                      <div className="dashboard-panel-title">
                        <span className="dashboard-panel-dot bg-brand-primary" />
                        <p className="dashboard-panel-label">Active Sessions</p>
                      </div>
                    </div>
                    <p className="max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
                      Review the devices currently signed in to your account. Revoke access from devices you do not recognize or no longer use.
                    </p>
                  </div>
                </section>

                {sessionsError && (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.08] p-4">
                    <div className="flex gap-3">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
                      <div>
                        <p className="text-sm font-semibold text-red-300">Failed to load sessions</p>
                        <p className="mt-1 text-xs leading-5 text-red-200/70">{sessionsError}</p>
                      </div>
                    </div>
                  </div>
                )}

                {isLoading && (
                  <div className="dashboard-panel p-8 text-center">
                    <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-primary" />
                    <p className="text-sm text-[var(--text-muted)]">Loading sessions...</p>
                  </div>
                )}

                {!isLoading && sessions.length === 0 && (
                  <div className="dashboard-panel p-8 text-center">
                    <p className="text-sm text-[var(--text-muted)]">No active sessions found.</p>
                  </div>
                )}

                {!isLoading && sessions.length > 0 && (
                  <div className="grid gap-3">
                    {sessions.map((session) => {
                      const isCurrent = session.id === currentSessionId;

                      return (
                        <div key={session.id} className="dashboard-panel overflow-hidden">
                          <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Smartphone className="h-4 w-4 text-[var(--text-muted)]" />
                                <p className="text-sm font-semibold text-[var(--text-primary)]">
                                  {session.device_name || session.device_type || "Unknown Device"}
                                </p>
                                {isCurrent && (
                                  <span className="rounded-full border border-brand-primary/25 bg-brand-primary/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-brand-primary">
                                    Current
                                  </span>
                                )}
                              </div>

                              <div className="mt-3 grid gap-2 text-sm text-[var(--text-secondary)] sm:grid-cols-2 xl:grid-cols-3">
                                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-3 py-2.5">
                                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    Platform
                                  </p>
                                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                                    {session.os_name || "OS unknown"}
                                  </p>
                                </div>
                                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-3 py-2.5">
                                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    Browser
                                  </p>
                                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                                    {session.browser_name
                                      ? `${session.browser_name} ${session.browser_version || ""}`.trim()
                                      : "Browser unknown"}
                                  </p>
                                </div>
                                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-3 py-2.5">
                                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                                    IP / Region
                                  </p>
                                  <p className="mt-1 break-words text-sm text-[var(--text-secondary)]">
                                    {session.location ? `${session.location} • ` : ""}
                                    {session.ip_address}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                <Clock3 className="h-3.5 w-3.5" />
                                Last seen {new Date(session.last_seen).toLocaleDateString()} {new Date(session.last_seen).toLocaleTimeString()}
                              </div>
                            </div>

                            {!isCurrent && (
                              <div className="shrink-0">
                                <button
                                  onClick={() => handleRevokeSession(session.id)}
                                  disabled={revokeLoading === session.id}
                                  className={cn(
                                    "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
                                    revokeLoading === session.id
                                      ? "cursor-not-allowed border border-red-500/15 bg-red-500/[0.08] text-red-300/60"
                                      : "border border-red-500/25 bg-red-500/[0.08] text-red-300 hover:bg-red-500/[0.14]"
                                  )}
                                >
                                  {revokeLoading === session.id ? (
                                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  ) : (
                                    <LogOut className="h-4 w-4" />
                                  )}
                                  Revoke
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "mfa" && <TwoFactorSettingsPage />}

            {isAdmin && activeTab === "master-settings" && (
              <AdminConfigurationWorkspace initialKPIs={initialKPIs} />
            )}

            {isAdmin && activeTab === "admin-console" && (
              <AdminCanonicalWorkspace initialKPIs={initialKPIs} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
