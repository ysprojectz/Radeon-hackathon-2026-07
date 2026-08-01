"use client";

import React, { useState, FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Smartphone, Copy, Download, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { TotpSetupResponseWithBackupCodes } from "@/lib/types";

interface SetupAuthenticatorProps {
  email: string;
  mfaPendingToken: string;
  onSuccess: () => void;
  onBackToPassword?: () => void;
  loading?: boolean;
}

type Step = "qr" | "verify" | "backup";

export default function SetupAuthenticator({
  email,
  mfaPendingToken,
  onSuccess,
  onBackToPassword,
  loading: externalLoading = false,
}: SetupAuthenticatorProps) {
  const [step, setStep] = useState<Step>("qr");
  const [qrB64, setQrB64] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load QR code on mount
  React.useEffect(() => {
    async function loadQR() {
      try {
        const { totpSetup } = await import("@/lib/api");
        const res = await totpSetup(email);
        setQrB64(res.qr_b64);
        setUri(res.uri);
        // If backup_codes are returned, we're on first setup
        if ((res as TotpSetupResponseWithBackupCodes).backup_codes) {
          // Don't set backup codes yet, wait for code verification
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to load QR code";
        setError(msg);
      }
    }
    loadQR();
  }, [email]);

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\s/g, "");
    if (clean.length !== 6) {
      setError("Enter all 6 digits");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const { totpLogin } = await import("@/lib/api");
      await totpLogin(email, clean, mfaPendingToken);

      // On successful first-time setup, get backup codes
      const { totpSetup } = await import("@/lib/api");
      const setupRes = await totpSetup(email);
      if ((setupRes as TotpSetupResponseWithBackupCodes).backup_codes) {
        setBackupCodes((setupRes as TotpSetupResponseWithBackupCodes).backup_codes!);
        setStep("backup");
      } else {
        // No backup codes returned, setup complete
        toast.success("Authenticator setup complete!");
        onSuccess();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      setError(msg);
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  function handleDownloadCodes() {
    const text = backupCodes.join("\n");
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(text));
    element.setAttribute("download", "claims-backup-codes.txt");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    toast.success("Backup codes downloaded");
  }

  function handleCopyCodes() {
    const text = backupCodes.join("\n");
    navigator.clipboard.writeText(text);
    toast.success("Backup codes copied to clipboard");
  }

  return (
    <div className="flex flex-col gap-[18px]">
      {/* QR Code Step */}
      {step === "qr" && (
        <div className="flex flex-col gap-[18px]">
          <div>
            <h2 className="text-sm font-semibold dark:text-white text-slate-900 mb-1">
              Set Up Authenticator
            </h2>
            <p className="text-[11px] dark:text-slate-400 text-slate-600">
              Protect your account with a 6-digit code from an authenticator app.
            </p>
          </div>

          {/* QR Code Area */}
          <div className="dark:border-white/10 border-slate-200 border rounded-xl dark:bg-white/[0.02] bg-slate-50 p-6 flex flex-col items-center gap-4">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] dark:text-slate-400 text-slate-500">
              <Smartphone className="w-3 h-3" />
              Scan with your authenticator app
            </p>

            {qrB64 && (
              <div className="dark:bg-white dark:border-white/20 bg-white border-2 border-slate-200 rounded-xl p-4 shadow-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/png;base64,${qrB64}`}
                  alt="TOTP QR code"
                  className="w-44 h-44 block rounded"
                />
              </div>
            )}

            {/* Setup steps */}
            <div className="flex flex-col gap-2 w-full">
              {([
                ["1", <>Open <strong>Google Authenticator</strong> or <strong>Authy</strong></>],
                ["2", <>Tap <strong>&quot;Add account&quot;</strong> → <strong>&quot;Scan QR code&quot;</strong></>],
                ["3", "Point your camera at the code above"],
                ["4", "A 6-digit code will appear in your app"],
              ] as [string, React.ReactNode][]).map(([num, text], i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-[18px] h-[18px] flex items-center justify-center rounded bg-cyan-500 text-[10px] font-black text-white mt-0.5">
                    {num}
                  </span>
                  <span className="text-[11px] dark:text-slate-400 text-slate-600 leading-relaxed">
                    {text}
                  </span>
                </div>
              ))}
            </div>

            {uri && (
              <details className="w-full">
                <summary className="text-[10px] font-semibold dark:text-slate-400 text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
                  Can&apos;t scan? Enter this code manually →
                </summary>
                <div className="mt-2 p-2 bg-slate-100 dark:bg-white/5 rounded font-mono text-[9px] break-all dark:text-slate-300 text-slate-700">
                  {uri}
                </div>
              </details>
            )}
          </div>

          {error && (
            <Alert variant="destructive" className="rounded-lg dark:bg-red-500/10 dark:border-red-500/20">
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}

          <button
            type="button"
            onClick={() => setStep("verify")}
            disabled={loading || externalLoading}
            className={cn(
              "h-11 w-full flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide transition-all",
              !loading && !externalLoading
                ? "bg-cyan-600 text-white hover:bg-cyan-500 hover:-translate-y-0.5 hover:shadow-lg dark:shadow-cyan-900/30"
                : "dark:bg-white/5 dark:text-slate-500 bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
            )}
          >
            I&apos;ve scanned it — Next <ArrowRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onBackToPassword}
            disabled={loading || externalLoading}
            className="text-[10px] uppercase tracking-[0.1em] dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-blue-600 transition-colors text-center py-1"
          >
            &larr; Back
          </button>
        </div>
      )}

      {/* Code Verification Step */}
      {step === "verify" && (
        <div className="flex flex-col gap-[18px]">
          <div>
            <h2 className="text-sm font-semibold dark:text-white text-slate-900 mb-1">
              Verify Your Setup
            </h2>
            <p className="text-[11px] dark:text-slate-400 text-slate-600">
              Enter the 6-digit code from your app to confirm.
            </p>
          </div>

          <input
            type="text"
            inputMode="numeric"
            placeholder="000000"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setError(null);
            }}
            disabled={loading || externalLoading}
            autoComplete="one-time-code"
            className={cn(
              "h-11 w-full px-4 rounded-lg text-center text-lg font-mono font-bold outline-none transition-all border",
              "dark:bg-white/80 dark:placeholder:text-slate-400",
              "bg-white text-slate-900 placeholder:text-slate-400 [-webkit-text-fill-color:#0f172a]",
              error
                ? "border-red-500 dark:bg-red-500/10 bg-red-50 focus:ring-2 focus:ring-red-500/20"
                : "dark:border-white/10 dark:focus:border-cyan-400 dark:focus:ring-2 dark:focus:ring-cyan-400/20 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            )}
          />

          {error && (
            <Alert variant="destructive" className="rounded-lg dark:bg-red-500/10 dark:border-red-500/20">
              <AlertDescription className="text-xs flex items-center gap-2">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {error}
              </AlertDescription>
            </Alert>
          )}

          <button
            type="button"
            onClick={handleVerifyCode}
            disabled={code.length !== 6 || loading || externalLoading}
            className={cn(
              "h-11 w-full flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide transition-all",
              code.length === 6 && !loading && !externalLoading
                ? "bg-cyan-600 text-white hover:bg-cyan-500 hover:-translate-y-0.5 hover:shadow-lg dark:shadow-cyan-900/30"
                : "dark:bg-white/5 dark:text-slate-500 bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
            )}
          >
            {loading || externalLoading ? (
              <Loader2 className="w-[18px] h-[18px] animate-spin" />
            ) : (
              <>Verify Code</>
            )}
          </button>

          <button
            type="button"
            onClick={() => setStep("qr")}
            disabled={loading || externalLoading}
            className="text-[10px] uppercase tracking-[0.1em] dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-blue-600 transition-colors text-center py-1"
          >
            &larr; Back to QR code
          </button>
        </div>
      )}

      {/* Backup Codes Step */}
      {step === "backup" && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex items-start gap-2 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-emerald-900 dark:text-emerald-300">
                Setup Complete!
              </h2>
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5">
                Save these backup codes in a safe place.
              </p>
            </div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] dark:text-slate-400 text-slate-500 mb-2">
              Backup Codes
            </p>
            <p className="text-[11px] dark:text-slate-400 text-slate-600 mb-3">
              Use these if you lose access to your authenticator. Each code can only be used once.
            </p>

            <div className="dark:bg-white/[0.02] bg-slate-50 border dark:border-white/10 border-slate-200 rounded-lg p-4 space-y-1 font-mono text-sm">
              {backupCodes.map((c, i) => (
                <div key={i} className="text-slate-700 dark:text-slate-300">
                  {c}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyCodes}
              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all
                bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-slate-100
                hover:bg-slate-200 dark:hover:bg-white/20"
            >
              <Copy className="w-4 h-4" />
              Copy
            </button>
            <button
              type="button"
              onClick={handleDownloadCodes}
              className="flex-1 h-10 flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all
                bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-slate-100
                hover:bg-slate-200 dark:hover:bg-white/20"
            >
              <Download className="w-4 h-4" />
              Download
            </button>
          </div>

          <label className="flex items-center gap-2 p-3 border dark:border-white/10 border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
            <input
              type="checkbox"
              checked={codesAcknowledged}
              onChange={(e) => setCodesAcknowledged(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span className="text-[11px] dark:text-slate-400 text-slate-600">
              I have saved my backup codes in a secure location
            </span>
          </label>

          <button
            type="button"
            onClick={onSuccess}
            disabled={!codesAcknowledged}
            className={cn(
              "h-11 w-full flex items-center justify-center gap-2 rounded-lg text-sm font-semibold tracking-wide transition-all",
              codesAcknowledged
                ? "bg-cyan-600 text-white hover:bg-cyan-500 hover:-translate-y-0.5 hover:shadow-lg dark:shadow-cyan-900/30"
                : "dark:bg-white/5 dark:text-slate-500 bg-slate-200 text-slate-400 cursor-not-allowed opacity-60"
            )}
          >
            Complete Setup
          </button>
        </div>
      )}
    </div>
  );
}
