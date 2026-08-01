"use client";

import React, { useState, useRef, KeyboardEvent, FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, KeyRound, AlertCircle, QrCode, Smartphone, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── 6-digit code input with auto-advance ────────────────────────────────────
function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
}) {
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  function handleChange(idx: number, raw: string) {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const arr = value.padEnd(6, " ").split("");
    arr[idx] = digit || " ";
    const next = arr.join("").trimEnd();
    onChange(next);
    if (next.length === 6) {
      onComplete?.();
      return;
    }
    if (digit && idx < 5) refs[idx + 1].current?.focus();
  }

  function handleKey(idx: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[idx] && idx > 0) {
      refs[idx - 1].current?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    onChange(pasted);
    if (pasted.length === 6) {
      onComplete?.();
      return;
    }
    refs[Math.min(pasted.length, 5)].current?.focus();
  }

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={refs[i]}
          type="text"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={(value[i] ?? "").trim()}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onClick={() => refs[i].current?.select()}
          autoComplete="one-time-code"
          className={cn(
            "w-12 h-14 text-center text-xl font-mono font-bold rounded-xl border outline-none shadow-sm transition-all",
            "bg-white/[0.03] border-white/[0.08] text-white",
            "focus:border-cyan-400 focus:ring-4 focus:ring-cyan-400/10",
            (value[i] ?? "").trim() && "bg-cyan-500/10 border-cyan-500/30",
            disabled && "opacity-30 cursor-not-allowed"
          )}
        />
      ))}
    </div>
  );
}

interface MFAVerifyProps {
  email: string;
  mfaPendingToken: string;
  onSuccess: () => void;
  onBackupCodeMode?: () => void;
  onBackToPassword?: () => void;
  loading?: boolean;
}

export default function MFAVerify({
  email,
  mfaPendingToken,
  onSuccess,
  onBackupCodeMode,
  onBackToPassword,
  loading: externalLoading = false,
}: MFAVerifyProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(300); // 5 minutes

  // QR code panel state
  const [showQR, setShowQR] = useState(false);
  const [qrB64, setQrB64] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const qrFetchedRef = useRef(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  // Timer countdown effect
  React.useEffect(() => {
    if (!mfaPendingToken) return;
    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          setError("MFA token expired. Please log in again.");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [mfaPendingToken]);

  async function handleVerify(e: FormEvent) {
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
      toast.success("Login successful!");
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      if (msg.includes("429") || msg.includes("Too many")) {
        setError("Too many failed attempts. Try again in 10 minutes.");
      } else {
        setError(msg);
      }
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleQR() {
    if (showQR) {
      setShowQR(false);
      return;
    }
    setShowQR(true);
    // Lazy-fetch: only call API on first open
    if (qrFetchedRef.current) return;
    setQrLoading(true);
    setQrError(null);
    try {
      const { totpSetup } = await import("@/lib/api");
      const res = await totpSetup(email);
      setQrB64(res.qr_b64);
      setUri(res.uri);
      qrFetchedRef.current = true;
    } catch (err: unknown) {
      setQrError(err instanceof Error ? err.message : "Failed to load QR code");
    } finally {
      setQrLoading(false);
    }
  }

  const mins = Math.floor(timeRemaining / 60);
  const secs = timeRemaining % 60;
  const isLowTime = timeRemaining < 60;

  function focusSubmitButton() {
    window.setTimeout(() => submitButtonRef.current?.focus(), 0);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Email badge - Deep Glass style */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-center">
        <p className="text-[10px] uppercase tracking-[0.1em] text-white/30 mb-1">
          Signing in as
        </p>
        <p className="text-sm font-bold truncate text-white">
          {email}
        </p>
      </div>

      <form onSubmit={handleVerify} className="flex flex-col gap-5">
        {/* Code input section */}
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">
            <KeyRound className="w-3.5 h-3.5 text-cyan-500" />
            Enter 6-digit code
          </label>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next);
              setError(null);
            }}
            onComplete={focusSubmitButton}
            disabled={loading || externalLoading}
          />
          <p className={cn(
            "text-center text-[10px] uppercase tracking-[0.15em] font-mono",
            isLowTime
              ? "text-red-400 font-bold animate-pulse"
              : "text-white/20"
          )}>
            {isLowTime ? "⚠️ Token expires in" : "Token expires in"} {mins}:{secs.toString().padStart(2, "0")}
          </p>
        </div>

        {error && (
          <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
            <AlertDescription className="text-xs text-red-400 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </AlertDescription>
          </Alert>
        )}

        <button
          ref={submitButtonRef}
          type="submit"
          disabled={code.replace(/\s/g, "").length !== 6 || loading || externalLoading}
          className={cn(
            "h-12 w-full flex items-center justify-center gap-2 rounded-xl text-sm font-bold tracking-wide transition-all",
            code.replace(/\s/g, "").length === 6 && !loading && !externalLoading
              ? "ui-button-primary"
              : "bg-white/5 text-white/20 cursor-not-allowed opacity-50"
          )}
        >
          {loading || externalLoading ? (
            <Loader2 className="w-[18px] h-[18px] animate-spin" />
          ) : (
            <>Verify & Sign In <Smartphone className="w-4 h-4 ml-1 opacity-50" /></>
          )}
        </button>
      </form>

      {/* QR Code panel — toggle to re-scan authenticator */}
      <div className="rounded-2xl border border-white/[0.08] overflow-hidden bg-white/[0.02]">
        <button
          type="button"
          onClick={handleToggleQR}
          disabled={loading || externalLoading}
          className="w-full flex items-center justify-between px-5 py-4 text-[11px] font-bold text-white/40 hover:bg-white/[0.04] transition-colors disabled:opacity-50"
        >
          <span className="flex items-center gap-2.5">
            <QrCode className="w-4 h-4 text-cyan-500" />
            Lost access? Scan QR code
          </span>
          {showQR
            ? <ChevronUp className="w-4 h-4 opacity-30" />
            : <ChevronDown className="w-4 h-4 opacity-30" />
          }
        </button>

        {showQR && (
          <div className="px-5 pb-6 pt-2 flex flex-col items-center gap-4 bg-white/[0.02] border-t border-white/[0.08]">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-white/30 self-start">
              <Smartphone className="w-3.5 h-3.5 text-cyan-400" />
              Scan with your authenticator
            </p>

            {qrLoading && (
              <div className="flex items-center gap-3 py-8 text-white/40 text-xs font-medium">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-500" />
                Generating secure QR…
              </div>
            )}

            {qrError && (
              <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10 w-full">
                <AlertDescription className="text-xs text-red-400 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {qrError}
                </AlertDescription>
              </Alert>
            )}

            {qrB64 && !qrLoading && (
              <>
                <div className="bg-white rounded-2xl p-4 shadow-[0_0_30px_rgba(0,212,220,0.2)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/png;base64,${qrB64}`}
                    alt="TOTP QR code"
                    className="w-40 h-40 block rounded-lg"
                  />
                </div>

                {uri && (
                  <details className="w-full">
                    <summary className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/60 cursor-pointer hover:text-cyan-400 transition-colors">
                      Manual Secret Key &rarr;
                    </summary>
                    <div className="mt-2 p-3 bg-black/40 border border-white/5 rounded-xl font-mono text-[10px] break-all text-cyan-400/80 leading-relaxed">
                      {uri}
                    </div>
                  </details>
                )}

                <p className="text-[10px] text-white/20 text-center leading-relaxed font-medium">
                  Scan to sync your device. A new code will<br />appear in your app immediately.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Helper links */}
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.1em]">
        <button
          type="button"
          onClick={onBackToPassword}
          disabled={loading || externalLoading}
          className="text-white/30 hover:text-white transition-colors py-1 disabled:opacity-50"
        >
          &larr; Back to login
        </button>
        {onBackupCodeMode && (
          <button
            type="button"
            onClick={onBackupCodeMode}
            disabled={loading || externalLoading}
            className="text-white/30 hover:text-cyan-400 transition-colors py-1 disabled:opacity-50"
          >
            Use backup code
          </button>
        )}
      </div>
    </div>
  );
}
