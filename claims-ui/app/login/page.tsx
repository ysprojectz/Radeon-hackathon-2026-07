"use client";

export const dynamic = "force-dynamic";

import React, { Suspense, useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AcosLogo } from "@/components/shared/AcosLogo";
import { login, ApiError, totpHasSetup, totpSetup } from "@/lib/api";
import { fetchCurrentUser } from "@/lib/auth";
import { PRODUCT_DISPLAY_NAME } from "@/lib/constants";
import { Loader2, ArrowLeft, ArrowRight, ShieldCheck, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import MFAVerify from "./mfa-verify";
import BackupCode from "./backup-code";
import SetupAuthenticator from "./setup-authenticator";

// ── Types ─────────────────────────────────────────────────────────────────────
type Step = "password" | "mfa_verify" | "mfa_backup" | "mfa_setup";

// ── Reusable input ───────────────────────────────────────────────────────────
function GlassInput({
  type = "text",
  placeholder,
  name,
  value,
  onChange,
  autoFocus,
  autoComplete,
  required,
  disabled,
}: {
  type?: string;
  placeholder?: string;
  name?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      name={name}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      required={required}
      disabled={disabled}
      className={cn(
        "ui-form-field login-form-field h-12 w-full px-4 text-sm font-medium",
        "bg-white/[0.03] border-white/[0.08] placeholder:text-white/20",
        "focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
      )}
    />
  );
}

// ── Reusable button ──────────────────────────────────────────────────────────
function GlassButton({
  type = "button",
  onClick,
  disabled,
  loading,
  children,
  variant = "primary",
}: {
  type?: "button" | "submit" | "reset";
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const isPrimary = variant === "primary";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "h-12 w-full text-sm font-bold tracking-wide transition-all",
        isPrimary ? "ui-button-primary" : "ui-button-secondary",
        (disabled || loading) && "opacity-50 cursor-not-allowed"
      )}
    >
      {loading ? <Loader2 className="w-[18px] h-[18px] animate-spin mx-auto" /> : children}
    </button>
  );
}

// ── Main Login Page ───────────────────────────────────────────────────────────
function LoginPageContent() {
  const router = useRouter();

  // Main state
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Redirect if already logged in - always go to dashboard
  useEffect(() => {
    setHydrated(true);
    fetchCurrentUser().then((user) => {
      if (user) router.replace("/");
    });
  }, [router]);

  // Step 1: Password login
  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const submittedEmail = String(formData.get("email") ?? email).trim();
    const submittedPassword = String(formData.get("password") ?? password);

    if (!submittedEmail || !submittedPassword) {
      setError("Email and password are required");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      setEmail(submittedEmail);
      setPassword(submittedPassword);
      const res = await login(submittedEmail, submittedPassword);

      // Check if response is MFAPendingToken or AccessToken
      if ("mfa_pending_token" in res && res.mfa_pending_token) {
        // MFA is required
        setMfaPendingToken(res.mfa_pending_token);

        // Check if TOTP is already configured
        const configured = await totpHasSetup(submittedEmail);
        if (configured) {
          setStep("mfa_verify");
        } else {
          // Need to set up TOTP first
          await totpSetup(submittedEmail);
          setStep("mfa_setup");
        }
      } else {
        // MFA not required, logged in successfully
        toast.success("Login successful!");
        router.replace("/");
      }
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.detail : err instanceof Error ? err.message : "Login failed";
      setError(msg);
      setPassword("");
    } finally {
      setLoading(false);
    }
  }

  function handleMFASuccess() {
    toast.success("Login successful!");
    router.replace("/");
  }

  function handleBackToPassword() {
    setStep("password");
    setMfaPendingToken(null);
    setError(null);
  }

  function handleBackToLanding() {
    router.push("/landing");
  }

  const stepTitles: Record<Step, string> = {
    password: "Login Portal",
    mfa_setup: "Setup 2FA",
    mfa_verify: "Verify Identity",
    mfa_backup: "Use Backup Code",
  };

  return (
    <div className="page-scroll min-h-screen flex items-center justify-center p-4 py-8 relative overflow-x-hidden bg-[var(--bg-dashboard)]">
      {/* Radial cyan bloom background */}
      <div 
        className="fixed inset-0 pointer-events-none opacity-40"
        style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 50%, var(--brand-primary-glow) 0%, transparent 65%)"
        }}
      />

      {/* Cinematic scan line */}
      <div className="scan-line" />

      {/* Floating particles */}
      <div className="particle" style={{ top: "15%", left: "10%" }} />
      <div className="particle" style={{ top: "25%", right: "15%" }} />
      <div className="particle" style={{ bottom: "20%", left: "20%" }} />

      <button
        type="button"
        onClick={handleBackToLanding}
        className="fixed left-5 top-5 z-20 inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 text-xs font-bold text-white/68 shadow-[0_14px_38px_rgba(0,0,0,0.24)] transition-all hover:border-cyan-300/24 hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45 sm:left-8 sm:top-8"
        aria-label="Back to landing page"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {/* Card wrapper */}
      <div className="relative z-10 w-full max-w-[420px] cinematic-page-in">
        {/* Product logo ABOVE the card */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <AcosLogo classic showLabel className="scale-125" />
        </div>

        <div className="relative">
          {/* Main Card */}
          <div className="deep-glass relative w-full overflow-hidden rounded-[1.75rem]">

          {/* Simple header - title only, no subtitle */}
          <div className="px-8 pt-8 pb-2 text-center">
            <h1 className="text-xl font-extrabold tracking-[0.12em] uppercase text-[var(--text-primary)]">
              {stepTitles[step]}
            </h1>
          </div>

          {/* Card body */}
          <div className="p-8 pt-6">

            {/* STEP 1 — Password Login */}
            {step === "password" && (
              <form method="post" onSubmit={handlePasswordSubmit} className="flex flex-col gap-6">
                <div className="flex flex-col gap-5">
                  {/* Email field */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40 flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-cyan-500" />
                      Email Address
                    </label>
                    <GlassInput
                      type="email"
                      name="email"
                      autoComplete="email"
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setError(null);
                      }}
                      placeholder="you@organization.com"
                      disabled={loading}
                    />
                  </div>

                  {/* Password field */}
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40 flex items-center gap-2">
                      <Lock className="w-3.5 h-3.5 text-cyan-500" />
                      Password
                    </label>
                    <GlassInput
                      type="password"
                      name="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      placeholder="Enter your password"
                      disabled={loading}
                    />
                  </div>
                </div>

                {error && (
                  <Alert variant="destructive" className="rounded-xl border-red-500/20 bg-red-500/10">
                    <AlertDescription className="text-xs text-red-400">
                      {error}
                    </AlertDescription>
                  </Alert>
                )}

                <GlassButton type="submit" loading={loading} disabled={!hydrated || loading}>
                  Sign In <ArrowRight className="w-4 h-4 ml-1" />
                </GlassButton>

                <div className="flex items-center justify-center gap-2 text-[11px] font-medium text-white/20">
                  <Lock className="w-3 h-3" />
                  Secured with 2FA
                </div>
              </form>
            )}

            {/* STEP 2 — MFA Verification (existing TOTP configured) */}
            {step === "mfa_verify" && mfaPendingToken && (
              <MFAVerify
                email={email}
                mfaPendingToken={mfaPendingToken}
                onSuccess={handleMFASuccess}
                onBackupCodeMode={() => setStep("mfa_backup")}
                onBackToPassword={handleBackToPassword}
                loading={loading}
              />
            )}

            {/* STEP 2b — Backup Code Alternative */}
            {step === "mfa_backup" && mfaPendingToken && (
              <BackupCode
                email={email}
                mfaPendingToken={mfaPendingToken}
                onSuccess={handleMFASuccess}
                onBackToCode={() => setStep("mfa_verify")}
                onBackToPassword={handleBackToPassword}
                loading={loading}
              />
            )}

            {/* STEP 2c — MFA Setup (first-time) */}
            {step === "mfa_setup" && mfaPendingToken && (
              <SetupAuthenticator
                email={email}
                mfaPendingToken={mfaPendingToken}
                onSuccess={handleMFASuccess}
                onBackToPassword={handleBackToPassword}
                loading={loading}
              />
            )}
          </div>

          </div>
        </div>

        {/* Footer note */}
        <p className="mt-8 text-[13px] font-medium dark:text-slate-600 text-slate-400 text-center">
          {PRODUCT_DISPLAY_NAME} &middot; Enterprise Solution &copy; 2026
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="page-scroll min-h-screen flex items-center justify-center overflow-x-hidden dark:bg-[var(--bg-primary)] bg-gradient-to-br from-slate-50 to-blue-50">
          <div className="glass-card flex items-center gap-3 rounded-[1.5rem] px-6 py-5 text-sm font-semibold text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading login experience...
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
