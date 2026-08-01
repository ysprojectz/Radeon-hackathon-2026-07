"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  RefreshCw,
  Shield,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useMFA } from "@/hooks/useMFA";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { TotpSetupResponseWithBackupCodes } from "@/lib/types";

interface TwoFactorSettings {
  required: boolean;
  enabled: boolean;
  type: string;
  verified_at?: string;
}

export default function TwoFactorSettingsPage() {
  const { checkIfConfigured, loadSetup } = useMFA();
  const [settings, setSettings] = useState<TwoFactorSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const { getMe } = await import("@/lib/api");
        const user = await getMe();
        setEmail(user.email);

        await checkIfConfigured(user.email);
        setSettings({
          required: user.mfa_required ?? false,
          enabled: user.mfa_enabled ?? false,
          type: "TOTP",
          verified_at: user.mfa_verified_at ?? undefined,
        });
      } catch (err) {
        console.error("Failed to load MFA settings", err);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [checkIfConfigured]);

  async function handleGenerateNewCodes() {
    if (!email) return;

    try {
      setShowModal(true);
      const res = await loadSetup(email);
      if ((res as TotpSetupResponseWithBackupCodes).backup_codes) {
        setBackupCodes((res as TotpSetupResponseWithBackupCodes).backup_codes!);
        toast.success("New backup codes generated");
      }
    } catch {
      toast.error("Failed to generate backup codes");
      setShowModal(false);
    }
  }

  function handleDownloadCodes() {
    const text = backupCodes.join("\n");
    const element = document.createElement("a");
    element.setAttribute("href", `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
    element.setAttribute("download", "claims-backup-codes.txt");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Backup codes downloaded");
  }

  function handleCopyCodes() {
    navigator.clipboard.writeText(backupCodes.join("\n")).then(() => {
      toast.success("Backup codes copied");
    });
  }

  if (isLoading) {
    return (
      <div className="dashboard-panel p-8 text-center">
        <div className="mx-auto mb-4 inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-brand-primary" />
        <p className="text-sm text-text-muted">Loading two-factor settings...</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <section className="dashboard-panel overflow-hidden">
          <div className="dashboard-panel-accent bg-brand-primary/25" />
          <div className="relative flex h-full flex-col gap-5 p-5">
            <div className="dashboard-panel-header">
              <div className="dashboard-panel-title">
                <span className="dashboard-panel-dot bg-brand-primary" />
                <p className="dashboard-panel-label">Two-Factor Authentication</p>
              </div>
            </div>

            <div
              className={cn(
                "rounded-[1.5rem] border p-4",
                settings?.enabled
                  ? "border-[var(--status-success)]/20 bg-[var(--status-success)]/[0.08]"
                  : "border-[var(--status-warning)]/20 bg-[var(--status-warning)]/[0.08]"
              )}
            >
              <div className="flex items-start gap-3">
                {settings?.enabled ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-success)]" />
                ) : (
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--status-warning)]" />
                )}
                <div className="min-w-0">
                  <h3
                    className={cn(
                      "text-sm font-semibold",
                      settings?.enabled ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"
                    )}
                  >
                    {settings?.enabled ? "Two-factor enabled" : "Two-factor not enabled"}
                  </h3>
                  {settings?.verified_at && (
                    <p className="mt-2 text-xs text-text-muted">
                      Last verified {new Date(settings.verified_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">Method</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">Authenticator app</p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">Standard</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">{settings?.type ?? "TOTP"}</p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-text-muted">Recovery</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">Backup codes</p>
              </div>
            </div>

            {settings?.enabled && (
              <div className="mt-auto flex flex-wrap gap-3">
                <Button variant="outline" size="sm" onClick={handleGenerateNewCodes} className="gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Generate New Codes
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-panel overflow-hidden">
          <div className="dashboard-panel-accent bg-brand-primary/25" />
          <div className="relative flex h-full flex-col gap-4 p-5">
            <div className="dashboard-panel-header">
              <div className="dashboard-panel-title">
                <span className="dashboard-panel-dot bg-brand-primary" />
                <p className="dashboard-panel-label">Authenticator Method</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-3">
              <div className="flex items-center gap-2 text-text-primary">
                <Smartphone className="h-4 w-4 text-text-muted" />
                <p className="text-sm font-semibold">Compatible Applications</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                Google Authenticator, Authy, Microsoft Authenticator, or any TOTP-compatible app.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-3">
              <div className="flex items-center gap-2 text-text-primary">
                <Shield className="h-4 w-4 text-text-muted" />
                <p className="text-sm font-semibold">Operational Guidance</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                Regenerate backup codes when needed and keep them outside your primary device to avoid lockout risk.
              </p>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Backup Codes</DialogTitle>
          </DialogHeader>

          <div className="rounded-[1.4rem] border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4">
            <p className="text-sm leading-6 text-text-secondary">
              Store these backup codes in a secure location. Each code can be used only once.
            </p>
          </div>

          <div className="grid max-h-64 gap-2 overflow-y-auto rounded-[1.4rem] border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4 font-mono text-sm text-text-primary">
            {backupCodes.map((code) => (
              <div key={code} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2">
                {code}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCopyCodes} className="gap-2">
              <Copy className="h-4 w-4" />
              Copy
            </Button>
            <Button variant="outline" onClick={handleDownloadCodes} className="gap-2">
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button onClick={() => setShowModal(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
