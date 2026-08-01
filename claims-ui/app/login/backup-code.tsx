"use client";

import React, { useState, FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface BackupCodeProps {
  email: string;
  mfaPendingToken: string;
  onSuccess: () => void;
  onBackToCode?: () => void;
  onBackToPassword?: () => void;
  loading?: boolean;
}

export default function BackupCode({
  email,
  mfaPendingToken,
  onSuccess,
  onBackToCode,
  onBackToPassword,
  loading: externalLoading = false,
}: BackupCodeProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    const clean = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    if (clean.length < 8) {
      setError("Backup code must be at least 8 characters");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const { totpLogin } = await import("@/lib/api");
      await totpLogin(email, clean, mfaPendingToken);
      toast.success("Login successful!");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(msg);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* Email badge */}
      <div className="border-slate-200 dark:border-white/10 border bg-slate-50 dark:bg-white/[0.02] rounded-lg p-3 text-center">
        <p className="text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-0.5">
          Signing in as
        </p>
        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{email}</p>
      </div>

      {/* Code input section */}
      <div className="flex flex-col gap-3">
        <label htmlFor="backup-code" className="text-[10px] font-bold uppercase tracking-[0.12em] dark:text-slate-400 text-slate-500">
          Enter Backup Code
        </label>
        <input
          id="backup-code"
          type="text"
          placeholder="E.g., XXXX-XXXX"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          disabled={loading || externalLoading}
          autoComplete="off"
          className={cn(
            "h-11 w-full px-4 rounded-lg text-sm font-medium outline-none transition-all border",
            "dark:bg-white/80 dark:placeholder:text-slate-400",
            "bg-white text-slate-900 placeholder:text-slate-400 [-webkit-text-fill-color:#0f172a] [&:-webkit-autofill]:[-webkit-text-fill-color:#0f172a]",
            error
              ? "border-red-500 dark:bg-red-500/10 bg-red-50 focus:ring-2 focus:ring-red-500/20"
              : "dark:border-white/10 dark:hover:border-cyan-400/30 dark:focus:border-cyan-400 dark:focus:ring-2 dark:focus:ring-cyan-400/20 border-slate-200 hover:border-blue-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          )}
        />
        <p className="text-[10px] dark:text-slate-600 text-slate-400">
          Backup codes are single-use only.
        </p>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-lg dark:bg-red-500/10 dark:border-red-500/20">
          <AlertDescription className="text-xs flex items-center gap-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {error}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleVerify} className="flex flex-col gap-3">
        <button
          type="submit"
          disabled={code.trim().length === 0 || loading || externalLoading}
          className={cn(
            "h-11 w-full flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide transition-all",
            code.trim().length > 0 && !loading && !externalLoading
              ? "bg-cyan-600 text-white hover:bg-cyan-500 hover:-translate-y-0.5 hover:shadow-lg dark:shadow-cyan-900/30"
              : "dark:bg-white/5 dark:text-slate-500 bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
          )}
        >
          {loading || externalLoading ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            "Verify Code"
          )}
        </button>
      </form>

      {/* Helper links */}
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.08em]">
        <button
          type="button"
          onClick={onBackToPassword}
          disabled={loading || externalLoading}
          className="dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-blue-600 transition-colors py-1 disabled:opacity-50"
        >
          &larr; Back to login
        </button>
        {onBackToCode && (
          <button
            type="button"
            onClick={onBackToCode}
            disabled={loading || externalLoading}
            className="dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-blue-600 transition-colors py-1 disabled:opacity-50"
          >
            Use authenticator app
          </button>
        )}
      </div>
    </div>
  );
}
