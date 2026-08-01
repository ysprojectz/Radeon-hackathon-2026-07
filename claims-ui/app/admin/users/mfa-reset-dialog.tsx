"use client";

import React, { useState, FormEvent } from "react";
import { AlertCircle, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MFAResetDialogProps {
  isOpen: boolean;
  email: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function MFAResetDialog({
  isOpen,
  email,
  onClose,
  onSuccess,
}: MFAResetDialogProps) {
  const [action, setAction] = useState<"reset_secret" | "disable_requirement">("reset_secret");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please provide a reason for the reset");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { resetUserMFA } = await import("@/lib/api");
      await resetUserMFA(email, action, reason);
      toast.success(`MFA ${action === "reset_secret" ? "reset" : "disabled"} for ${email}`);
      onSuccess?.();
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reset MFA";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  function handleClose() {
    setAction("reset_secret");
    setReason("");
    setError(null);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="dark:bg-slate-900 bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b dark:border-white/10 border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="text-lg font-bold dark:text-white text-slate-900">
              Reset Two-Factor Authentication
            </h2>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            For: <span className="font-semibold">{email}</span>
          </p>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Warning alert */}
          <div className="flex gap-3 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-700 dark:text-amber-400">
              This action will require the user to set up their authenticator again before they can log in.
            </div>
          </div>

          {/* Action selection */}
          <div className="space-y-3">
            <label className="text-sm font-semibold dark:text-white text-slate-900">
              Action
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-3 p-3 border dark:border-white/10 border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="radio"
                  name="action"
                  value="reset_secret"
                  checked={action === "reset_secret"}
                  onChange={(e) => setAction(e.target.value as "reset_secret" | "disable_requirement")}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium dark:text-white text-slate-900">
                    Reset Authenticator Secret
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    User must re-scan QR code on next login
                  </p>
                </div>
              </label>

              <label className="flex items-center gap-3 p-3 border dark:border-white/10 border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                <input
                  type="radio"
                  name="action"
                  value="disable_requirement"
                  checked={action === "disable_requirement"}
                  onChange={(e) => setAction(e.target.value as "reset_secret" | "disable_requirement")}
                  className="w-4 h-4"
                />
                <div>
                  <p className="text-sm font-medium dark:text-white text-slate-900">
                    Disable MFA Requirement
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    User can log in without 2FA (for API accounts, etc.)
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Reason input */}
          <div>
            <label htmlFor="reason" className="text-sm font-semibold dark:text-white text-slate-900 block mb-2">
              Reason for Reset *
            </label>
            <textarea
              id="reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              placeholder="e.g., User lost device, Account compromised..."
              className={cn(
                "w-full px-4 py-2 rounded-lg text-sm outline-none transition-all border",
                "dark:bg-white/80 dark:placeholder:text-slate-400",
                "bg-white text-slate-900 placeholder:text-slate-400 [-webkit-text-fill-color:#0f172a]",
                error
                  ? "border-red-500 dark:bg-red-500/10 bg-red-50 focus:ring-2 focus:ring-red-500/20"
                  : "dark:border-white/10 dark:focus:border-cyan-400 dark:focus:ring-2 dark:focus:ring-cyan-400/20 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              )}
              rows={3}
            />
          </div>

          {error && (
            <div className="flex gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all
                dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/20
                bg-slate-100 text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !reason.trim()}
              className={cn(
                "flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                isLoading || !reason.trim()
                  ? "dark:bg-red-500/30 dark:text-red-300 bg-red-100 text-red-700 cursor-not-allowed opacity-60"
                  : "dark:bg-red-600 dark:text-white dark:hover:bg-red-700 bg-red-600 text-white hover:bg-red-700"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Reset MFA"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
