"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Eye,
  EyeOff,
  Landmark,
  Loader2,
  RefreshCw,
  Save,
  Unplug,
  Wallet,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  getGatewayConfigs,
  createCashfreeOrder,
  getCashfreeOrderPayments,
  saveStripeConfig,
  savePaytmConfig,
  saveCashfreeConfig,
  testGatewayConnection,
  getGatewayPayouts,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GatewayConfig, GatewayEnvironment, GatewayPayout, PayoutStatus } from "@/lib/types";

// ── Design tokens — identical to accounts/page ────────────────────────────────

const inputClass =
  "h-11 w-full rounded-xl border border-white/[0.10] bg-white/[0.045] px-3 text-sm text-white/85 outline-none transition-colors placeholder:text-white/24 focus:border-brand-primary/50 focus:bg-white/[0.065]";
const labelClass = "ui-control-label mb-1.5 block text-white/42";

// ── Shared sub-components ─────────────────────────────────────────────────────

/** Status badge — aligned with accounts/page statusTone pattern */
function ReadyBadge({ ready, tested }: { ready: boolean; tested: boolean }) {
  if (!tested)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.055] px-2.5 py-1 text-xs font-semibold text-white/42">
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
        Not Tested
      </span>
    );
  if (ready)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Ready
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/25 bg-red-400/10 px-2.5 py-1 text-xs font-semibold text-red-300">
      <AlertCircle className="h-3.5 w-3.5" />
      Connection Failed
    </span>
  );
}

const DEFAULT_GATEWAY_ENV: GatewayEnvironment = "preproduction";

const gatewayEnvLabels: Record<GatewayEnvironment, string> = {
  sandbox: "Sandbox",
  preproduction: "Pre-prod",
  production: "Production",
};

/** Sandbox / Pre-production / Production toggle — styled consistently with filter bar pattern */
function EnvToggle({
  value,
  onChange,
}: {
  value: GatewayEnvironment;
  onChange: (v: GatewayEnvironment) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/[0.10] bg-white/[0.045] p-0.5">
      {(["sandbox", "preproduction", "production"] as const).map((env) => (
        <button
          key={env}
          type="button"
          onClick={() => onChange(env)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
            value === env
              ? "bg-brand-primary/90 text-white shadow-sm"
              : "text-white/42 hover:text-white/70",
          )}
        >
          {gatewayEnvLabels[env]}
        </button>
      ))}
    </div>
  );
}

function ConnectivityHint({ gateway, env }: { gateway: "stripe" | "paytm" | "cashfree"; env: GatewayEnvironment }) {
  const isProduction = env === "production";
  const title = isProduction ? "Production connectivity" : env === "preproduction" ? "Pre-production connectivity" : "Sandbox connectivity";
  const lines =
    gateway === "stripe"
      ? [
          "Stripe API: https://api.stripe.com/v1",
          isProduction ? "Expected keys: pk_live_ / sk_live_" : "Expected keys: pk_test_ / sk_test_",
        ]
      : gateway === "paytm"
        ? [
          `PayTM payouts: ${isProduction ? "https://autopay.paytm.com" : "https://staging-autopay.paytm.com"}`,
          `PayTM beneficiary validation: ${isProduction ? "https://dashboard.paytm.com/bpay/api/v1/beneficiary/validate" : "https://staging-dashboard.paytm.com/bpay/api/v1/beneficiary/validate"}`,
          `PayTM checkout: ${isProduction ? "https://secure.paytmpayments.com" : "https://securestage.paytmpayments.com"}`,
          isProduction ? "Website: DEFAULT" : "Website: WEBSTAGING",
        ]
        : [
          "Cashfree JS SDK: https://sdk.cashfree.com/js/v3/cashfree.js",
          `Client mode: ${isProduction ? "production" : "sandbox"}`,
          `Cashfree checkout: ${isProduction ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg"}`,
          `Cashfree verification: ${isProduction ? "https://api.cashfree.com/verification/bank-account/async" : "https://sandbox.cashfree.com/verification/bank-account/async"}`,
          "Used only as bank-account verification fallback before payout.",
        ];

  return (
    <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-3">
      <p className="ui-eyebrow text-[var(--status-info)]/55">{title}</p>
      <div className="mt-2 space-y-1">
        {lines.map((line) => (
          <p key={line} className="break-all font-mono text-xs text-cyan-100/70">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Enable / Disable button pair — uses ui-button-secondary / ui-button-primary pattern */
function EnableToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/[0.10] bg-white/[0.045] p-0.5">
      <button
        type="button"
        onClick={() => onChange(false)}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
          !enabled ? "bg-white/[0.08] text-white/82 shadow-sm" : "text-white/42 hover:text-white/70",
        )}
      >
        Disabled
      </button>
      <button
        type="button"
        onClick={() => onChange(true)}
        className={cn(
          "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
          enabled ? "bg-emerald-500/20 text-emerald-300 shadow-sm" : "text-white/42 hover:text-white/70",
        )}
      >
        Enabled
      </button>
    </div>
  );
}

/** Password / reveal input — uses the standard inputClass */
function SecretField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label>
      <span className={labelClass}>{label}</span>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "Enter value…"}
          className={cn(inputClass, "pr-10")}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          title={show ? "Hide" : "Show"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 transition-colors hover:text-white/60"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

/** Payout status badge — mirrors statusTone from accounts/page */
function PayoutStatusBadge({ status }: { status: PayoutStatus }) {
  const tone: Record<PayoutStatus, string> = {
    PENDING:    "border-white/10 bg-white/[0.055] text-white/60",
    PROCESSING: "border-amber-400/25 bg-amber-400/10 text-amber-300",
    COMPLETED:  "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
    FAILED:     "border-red-400/25 bg-red-400/10 text-red-300",
    CANCELLED:  "border-white/10 bg-white/[0.04] text-white/30",
  };
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", tone[status] ?? tone.PENDING)}>
      {status}
    </span>
  );
}

/** Inline test-result feedback — used after connection test */
function TestResultBanner({ result }: { result: { ok: boolean; detail: string } }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        result.ok
          ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300"
          : "border-red-400/25 bg-red-400/10 text-red-300",
      )}
    >
      {result.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <p>{result.detail}</p>
    </div>
  );
}

/** Webhook URL hint card — glass-card sub-card matching modal detail card */
function WebhookHint({ gateway, events }: { gateway: string; events?: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  return (
    <div className="glass-card px-4 py-3">
      <p className="ui-eyebrow text-white/28">
        Webhook endpoint — register in {gateway === "stripe" ? "Stripe Dashboard" : "PayTM Business Console"}
      </p>
      <p className="mt-2 break-all font-mono text-xs text-brand-primary">
        {origin ? `${origin}/api/v1/proxy/gateway/webhook/${gateway}` : `/api/v1/proxy/gateway/webhook/${gateway}`}
      </p>
      {events && (
        <p className="mt-1 text-xs text-white/36">
          Events: <code className="text-white/50">{events}</code>
        </p>
      )}
    </div>
  );
}

function formatMinor(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

// ── Stripe configuration panel ────────────────────────────────────────────────

function StripePanel({ initial }: { initial: GatewayConfig | null }) {
  const [env,        setEnv]        = useState<GatewayEnvironment>(initial?.environment ?? DEFAULT_GATEWAY_ENV);
  const [enabled,    setEnabled]    = useState(initial?.is_enabled ?? false);
  const [pubKey,     setPubKey]     = useState("");
  const [secretKey,  setSecretKey]  = useState("");
  const [webhookSec, setWebhookSec] = useState("");
  const [accountId,  setAccountId]  = useState(initial?.stripe_account_id ?? "");
  const [saving,     setSaving]     = useState(false);
  const [testing,    setTesting]    = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [open,       setOpen]       = useState(true);

  async function save() {
    setSaving(true);
    try {
      await saveStripeConfig({
        environment:            env,
        is_enabled:             enabled,
        stripe_publishable_key: pubKey,
        stripe_secret_key:      secretKey,
        stripe_webhook_secret:  webhookSec,
        stripe_account_id:      accountId,
      });
      toast.success("Stripe configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConn() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGatewayConnection("stripe");
      setTestResult(r);
      if (r.ok) toast.success(`Stripe connected — ${r.detail}`);
      else toast.error(`Stripe connection failed — ${r.detail}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestResult({ ok: false, detail: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  const tested = testResult !== null || initial?.last_test_status != null;
  const ready  = testResult?.ok ?? initial?.last_test_status === "ok";

  return (
    <section className="glass-card overflow-hidden">
      {/* ── Section header — matches accounts/page section header pattern ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
            <CreditCard className="h-5 w-5" />
          </span>
          <div className="text-left">
            <p className="ui-eyebrow text-white/30">Stripe</p>
            <h2 className="text-sm font-semibold text-white">Card-network bank payouts · REST service v2023-10-16</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ReadyBadge ready={!!ready} tested={tested} />
          <ChevronDown
            className={cn("h-4 w-4 text-white/30 transition-transform duration-200", open && "rotate-180")}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/[0.06] px-5 pb-5 pt-5 sm:px-6">

          {/* Environment + enable row */}
          <div className="flex flex-wrap items-center gap-3">
            <EnvToggle value={env} onChange={setEnv} />
            <EnableToggle enabled={enabled} onChange={setEnabled} />
          </div>
          <ConnectivityHint gateway="stripe" env={env} />

          {/* Credentials grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <SecretField
              label="Publishable Key  (pk_test_ / pk_live_)"
              value={pubKey}
              onChange={setPubKey}
              placeholder={initial?.stripe_publishable_key ? "••••••••" : env === "production" ? "pk_live_…" : "pk_test_…"}
            />
            <SecretField
              label="Secret Key  ★ required  (sk_test_ / sk_live_)"
              value={secretKey}
              onChange={setSecretKey}
              placeholder={initial?.stripe_secret_key ? "••••••••" : env === "production" ? "sk_live_…" : "sk_test_…"}
            />
            <SecretField
              label="Webhook Signing Secret  (whsec_…)"
              value={webhookSec}
              onChange={setWebhookSec}
              placeholder={initial?.stripe_webhook_secret ? "••••••••" : "whsec_…"}
            />
            <label>
              <span className={labelClass}>Connected Account ID  (acct_…)</span>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="acct_…"
                className={inputClass}
              />
            </label>
          </div>

          {/* Webhook URL hint */}
          <WebhookHint gateway="stripe" events="payout.paid  payout.failed  payout.canceled" />

          {/* Test result feedback */}
          {testResult && <TestResultBanner result={testResult} />}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="ui-button-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Configuration
            </button>
            <button
              onClick={testConn}
              disabled={testing}
              className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Test Connection
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── PayTM configuration panel ─────────────────────────────────────────────────

function PaytmPanel({ initial }: { initial: GatewayConfig | null }) {
  const [env,      setEnv]      = useState<GatewayEnvironment>(initial?.environment ?? DEFAULT_GATEWAY_ENV);
  const [enabled,  setEnabled]  = useState(initial?.is_enabled ?? false);
  const [mid,      setMid]      = useState(initial?.paytm_merchant_id ?? "");
  const [mKey,     setMKey]     = useState("");
  const [subwalletGuid, setSubwalletGuid] = useState(initial?.paytm_subwallet_guid ?? "");
  const [website,  setWebsite]  = useState(initial?.paytm_website ?? "WEBSTAGING");
  const [industry, setIndustry] = useState(initial?.paytm_industry_type ?? "Retail");
  const [channel,  setChannel]  = useState(initial?.paytm_channel_id ?? "WEB");
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [open,     setOpen]     = useState(true);

  function changeEnv(next: GatewayEnvironment) {
    setEnv(next);
    if (next !== "production") {
      setWebsite("WEBSTAGING");
      setChannel("WEB");
      if (!industry) setIndustry("Retail");
    }
  }

  async function save() {
    setSaving(true);
    try {
      await savePaytmConfig({
        environment:         env,
        is_enabled:          enabled,
        paytm_merchant_id:   mid,
        paytm_merchant_key:  mKey,
        paytm_subwallet_guid: subwalletGuid,
        paytm_website:       website,
        paytm_industry_type: industry,
        paytm_channel_id:    channel,
      });
      toast.success("PayTM configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConn() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGatewayConnection("paytm");
      setTestResult(r);
      if (r.ok) toast.success(`PayTM connected — ${r.detail}`);
      else toast.error(`PayTM connection failed — ${r.detail}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestResult({ ok: false, detail: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  const tested = testResult !== null || initial?.last_test_status != null;
  const ready  = testResult?.ok ?? initial?.last_test_status === "ok";

  return (
    <section className="glass-card overflow-hidden">
      {/* ── Section header ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-sky-400/20 bg-sky-400/10 text-sky-300">
            <Wallet className="h-5 w-5" />
          </span>
          <div className="text-left">
            <p className="ui-eyebrow text-white/30">PayTM</p>
            <h2 className="text-sm font-semibold text-white">India NEFT / IMPS / UPI payouts · PayTM Business service</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ReadyBadge ready={!!ready} tested={tested} />
          <ChevronDown
            className={cn("h-4 w-4 text-white/30 transition-transform duration-200", open && "rotate-180")}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/[0.06] px-5 pb-5 pt-5 sm:px-6">

          {/* Environment + enable row */}
          <div className="flex flex-wrap items-center gap-3">
            <EnvToggle value={env} onChange={changeEnv} />
            <EnableToggle enabled={enabled} onChange={setEnabled} />
          </div>
          <ConnectivityHint gateway="paytm" env={env} />

          {/* Credentials grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Merchant ID (MID)  ★ required</span>
              <input
                value={mid}
                onChange={(e) => setMid(e.target.value)}
                placeholder="YOUR_MID"
                className={inputClass}
              />
            </label>
            <SecretField
              label="Merchant Key  ★ required"
              value={mKey}
              onChange={setMKey}
              placeholder={initial?.paytm_merchant_key ? "••••••••" : "Enter merchant key…"}
            />
            <label>
              <span className={labelClass}>Subwallet GUID  ★ required for bank verification</span>
              <input
                value={subwalletGuid}
                onChange={(e) => setSubwalletGuid(e.target.value)}
                placeholder="PayTM subwallet GUID"
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Website</span>
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="WEBSTAGING"
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Industry Type</span>
              <input
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Retail"
                className={inputClass}
              />
            </label>
            <label>
              <span className={labelClass}>Channel ID</span>
              <input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="WEB"
                className={inputClass}
              />
            </label>
          </div>

          {/* Webhook URL hint */}
          <WebhookHint gateway="paytm" />

          {/* Test result feedback */}
          {testResult && <TestResultBanner result={testResult} />}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="ui-button-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Configuration
            </button>
            <button
              onClick={testConn}
              disabled={testing}
              className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Test Connection
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Payout transaction ledger ─────────────────────────────────────────────────

function CashfreePanel({ initial }: { initial: GatewayConfig | null }) {
  const [env, setEnv] = useState<GatewayEnvironment>(initial?.environment ?? DEFAULT_GATEWAY_ENV);
  const [enabled, setEnabled] = useState(initial?.is_enabled ?? false);
  const [clientId, setClientId] = useState(initial?.cashfree_client_id ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [checkingPayments, setCheckingPayments] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [orderId, setOrderId] = useState("");
  const [paymentSessionId, setPaymentSessionId] = useState("");
  const [paymentsResult, setPaymentsResult] = useState<unknown>(null);
  const [open, setOpen] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await saveCashfreeConfig({
        environment: env,
        is_enabled: enabled,
        cashfree_client_id: clientId,
        cashfree_client_secret: clientSecret,
      });
      toast.success("Cashfree verification configuration saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function testConn() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await testGatewayConnection("cashfree");
      setTestResult(r);
      if (r.ok) toast.success(`Cashfree configured — ${r.detail}`);
      else toast.error(`Cashfree check failed — ${r.detail}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Test failed";
      setTestResult({ ok: false, detail: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function createSandboxOrder() {
    setCreatingOrder(true);
    try {
      const orderId = `acos_${Date.now()}`;
      const result = await createCashfreeOrder({
        order_amount: 1,
        order_currency: "INR",
        order_id: orderId,
        customer_id: "acos_sandbox_user",
        customer_phone: "9876543210",
        return_url: `${window.location.origin}/admin?payment_order_id={order_id}`,
      });
      setOrderId(result.order_id ?? orderId);
      setPaymentSessionId(result.payment_session_id ?? "");
      setPaymentsResult(null);
      toast.success("Cashfree sandbox order created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cashfree order creation failed");
    } finally {
      setCreatingOrder(false);
    }
  }

  async function checkPayments() {
    if (!orderId) {
      toast.error("Create an order first");
      return;
    }
    setCheckingPayments(true);
    try {
      const result = await getCashfreeOrderPayments(orderId);
      setPaymentsResult(result);
      toast.success("Cashfree payment status loaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to fetch Cashfree payments");
    } finally {
      setCheckingPayments(false);
    }
  }

  async function openCheckout() {
    if (!paymentSessionId) {
      toast.error("Create a sandbox order first");
      return;
    }
    if (!document.querySelector('script[src="https://sdk.cashfree.com/js/v3/cashfree.js"]')) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Unable to load Cashfree SDK"));
        document.head.appendChild(script);
      });
    }
    const cashfreeFactory = (window as unknown as { Cashfree?: (opts: { mode: "sandbox" | "production" }) => { checkout: (opts: { paymentSessionId: string; redirectTarget: "_self" | "_blank" | "_top" | "_modal" }) => Promise<unknown> } }).Cashfree;
    if (!cashfreeFactory) {
      toast.error("Cashfree SDK is not available");
      return;
    }
    const cashfree = cashfreeFactory({ mode: env === "production" ? "production" : "sandbox" });
    await cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });
  }

  const tested = testResult !== null || initial?.last_test_status != null;
  const ready = testResult?.ok ?? initial?.last_test_status === "ok";

  return (
    <section className="glass-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-5 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
            <Landmark className="h-5 w-5" />
          </span>
          <div className="text-left">
            <p className="ui-eyebrow text-white/30">Cashfree</p>
            <h2 className="text-sm font-semibold text-white">Bank account verification fallback · Verification Suite</h2>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <ReadyBadge ready={!!ready} tested={tested} />
          <ChevronDown className={cn("h-4 w-4 text-white/30 transition-transform duration-200", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-white/[0.06] px-5 pb-5 pt-5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <EnvToggle value={env} onChange={setEnv} />
            <EnableToggle enabled={enabled} onChange={setEnabled} />
          </div>
          <ConnectivityHint gateway="cashfree" env={env} />
          <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.05] px-4 py-3">
            <p className="ui-eyebrow text-emerald-200/55">Client SDK Setup</p>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-black/20 p-3 text-xs text-emerald-100/70">
{`<script src="https://sdk.cashfree.com/js/v3/cashfree.js"></script>
const cashfree = Cashfree({ mode: "${env === "production" ? "production" : "sandbox"}" });
cashfree.checkout({ paymentSessionId, redirectTarget: "_self" });`}
            </pre>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
            <p className="ui-eyebrow text-white/32">Webhook Preview</p>
            <p className="mt-2 break-all font-mono text-xs text-white/50">
              https://www.cashfree.com/devstudio/preview/pg/webhooks/85532034
            </p>
            <p className="mt-2 break-all font-mono text-xs text-white/38">
              Local receiver: {typeof window !== "undefined" ? window.location.origin : ""}/api/v1/proxy/gateway/webhook/cashfree
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Client ID</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Cashfree client id" className={inputClass} />
            </label>
            <SecretField
              label="Client Secret"
              value={clientSecret}
              onChange={setClientSecret}
              placeholder={initial?.cashfree_client_secret ? "••••••••" : "Cashfree client secret"}
            />
          </div>
          {testResult && <TestResultBanner result={testResult} />}
          <div className="flex flex-wrap gap-3">
            <button onClick={save} disabled={saving} className="ui-button-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Configuration
            </button>
            <button onClick={testConn} disabled={testing} className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Test Configuration
            </button>
            <button onClick={createSandboxOrder} disabled={creatingOrder} className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold">
              {creatingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Create Sandbox Order
            </button>
            <button onClick={openCheckout} disabled={!paymentSessionId} className="ui-button-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-40">
              <CreditCard className="h-4 w-4" />
              Open Checkout
            </button>
            <button onClick={checkPayments} disabled={!orderId || checkingPayments} className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:opacity-40">
              {checkingPayments ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Check Payments
            </button>
          </div>
          {orderId && (
            <p className="break-all font-mono text-xs text-white/50">order_id: {orderId}</p>
          )}
          {paymentSessionId && (
            <p className="break-all font-mono text-xs text-white/50">payment_session_id: {paymentSessionId}</p>
          )}
          {paymentsResult != null && (
            <pre className="max-h-56 overflow-auto rounded-xl border border-white/[0.08] bg-black/20 p-3 text-xs text-white/58">
              {JSON.stringify(paymentsResult, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function PayoutHistory() {
  const [payouts,   setPayouts]   = useState<GatewayPayout[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [refreshAt, setRefreshAt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGatewayPayouts({ page: 1, page_size: 20 })
      .then((r) => {
        setPayouts(r.payouts);
        setError(null);
      })
      .catch((err) => {
        setPayouts([]);
        setError(err instanceof Error ? err.message : "Failed to load payout ledger");
      })
      .finally(() => setLoading(false));
  }, [refreshAt]);

  return (
    <section className="glass-card overflow-hidden">
      {/* ── Section header — identical rhythm to accounts table header ── */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--status-info)]/20 bg-[var(--status-info)]/10 text-[var(--status-info)]">
            <Zap className="h-5 w-5" />
          </span>
          <div>
            <p className="ui-eyebrow text-white/30">Payout Ledger</p>
            <h2 className="text-sm font-semibold text-white">Recent disbursements</h2>
          </div>
        </div>
        <button
          onClick={() => setRefreshAt(Date.now())}
          className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {loading ? (
        /* Loading — py-16 text-sm text-white/42 matches accounts loading state exactly */
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/42">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading payouts…
        </div>
      ) : payouts.length === 0 ? (
        error ? (
          <div className="p-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-red-300/70" />
            <p className="mt-3 text-sm font-semibold text-red-200">Payout ledger unavailable</p>
            <p className="mt-1 text-xs text-red-100/50">{error}</p>
          </div>
        ) : (
        /* Empty state — h-10 w-10 / text-white/24 / text-white/74 / text-white/36 */
        <div className="p-10 text-center">
          <Zap className="mx-auto h-10 w-10 text-white/24" />
          <p className="mt-3 text-sm font-semibold text-white/74">No payouts yet</p>
          <p className="mt-1 text-xs text-white/36">
            Initiate your first payout from a verified account on the Accounts page.
          </p>
        </div>
        )
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            {/* thead — exact tokens from accounts/page */}
            <thead className="bg-white/[0.025] text-[11px] uppercase tracking-[0.16em] text-white/36">
              <tr>
                <th className="px-5 py-3 font-semibold">Gateway</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Claim Ref</th>
                <th className="px-5 py-3 font-semibold">Txn ID</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Initiated</th>
              </tr>
            </thead>
            {/* tbody — divide-y divide-white/[0.06] + transition-colors on hover */}
            <tbody className="divide-y divide-white/[0.06]">
              {payouts.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-white/[0.025]">
                  <td className="px-5 py-4">
                    {/* Gateway badge — rounded-full, mirrors status badge shape */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
                        p.gateway === "stripe"
                          ? "border-indigo-400/25 bg-indigo-400/10 text-indigo-300"
                          : "border-sky-400/25 bg-sky-400/10 text-sky-300",
                      )}
                    >
                      {p.gateway === "stripe" ? (
                        <CreditCard className="h-3 w-3" />
                      ) : (
                        <Wallet className="h-3 w-3" />
                      )}
                      {p.gateway.toUpperCase()}
                    </span>
                  </td>
                  {/* Amount — text-sm font-semibold text-white */}
                  <td className="px-5 py-4 text-sm font-semibold text-white">
                    {formatMinor(p.amount_minor, p.currency)}
                  </td>
                  {/* Claim ref — text-xs text-white/42 matches accounts sub-text */}
                  <td className="px-5 py-4 text-xs text-white/42">
                    {p.claim_reference ?? "—"}
                  </td>
                  {/* Txn ID — font-mono only on the identifier value, not the label */}
                  <td className="px-5 py-4 font-mono text-xs text-white/42">
                    {p.gateway_txn_id ?? "—"}
                  </td>
                  <td className="px-5 py-4">
                    <PayoutStatusBadge status={p.status} />
                  </td>
                  {/* Date — text-xs text-white/42 */}
                  <td className="px-5 py-4 text-xs text-white/42">
                    {new Date(p.initiated_at).toLocaleString(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function GatewayConfigPage() {
  const [configs, setConfigs] = useState<{
    stripe: GatewayConfig | null;
    paytm:  GatewayConfig | null;
    cashfree: GatewayConfig | null;
  }>({ stripe: null, paytm: null, cashfree: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setLoadError(null);
    getGatewayConfigs()
      .then(({ gateways }) => {
        const byName = Object.fromEntries(gateways.map((g) => [g.gateway, g]));
        setConfigs({ stripe: byName.stripe ?? null, paytm: byName.paytm ?? null, cashfree: byName.cashfree ?? null });
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load gateway configuration"))
      .finally(() => setLoading(false));
  }, []);

  const stripeReady = configs.stripe?.is_ready;
  const paytmReady  = configs.paytm?.is_ready;
  const cashfreeReady = configs.cashfree?.is_ready;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Gateways"
      />

      {loadError && (
        <section className="rounded-2xl border border-red-400/20 bg-red-400/[0.08] px-5 py-4 text-sm text-red-100/80">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <div>
              <p className="font-semibold text-red-100">Gateway configuration unavailable</p>
              <p className="mt-1 text-xs text-red-100/55">{loadError}</p>
            </div>
          </div>
        </section>
      )}

      {/* ── Gateway status overview — matches section header surface pattern ── */}
      <section className="glass-card overflow-hidden px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[var(--status-info)]/20 bg-[var(--status-info)]/10 text-[var(--status-info)]">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <p className="ui-eyebrow text-white/30">Gateway Status</p>
              <h2 className="text-lg font-semibold text-white">Payment gateway configuration</h2>
            </div>
          </div>
          {/* Ready badges side-by-side */}
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-300" />
              <span className="text-xs font-semibold text-white/70">Stripe</span>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" />
              ) : (
                <ReadyBadge ready={!!stripeReady} tested={configs.stripe?.last_test_status != null} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-sky-300" />
              <span className="text-xs font-semibold text-white/70">PayTM</span>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" />
              ) : (
                <ReadyBadge ready={!!paytmReady} tested={configs.paytm?.last_test_status != null} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-emerald-300" />
              <span className="text-xs font-semibold text-white/70">Cashfree</span>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-white/30" />
              ) : (
                <ReadyBadge ready={!!cashfreeReady} tested={configs.cashfree?.last_test_status != null} />
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Quick-setup steps — glass-card with eyebrow header ── */}
      <section className="glass-card px-5 py-5 sm:px-6">
        <p className="ui-eyebrow text-white/30">Quick Setup</p>
        <ol className="mt-3 space-y-2 text-sm text-white/60">
          <li>
            <span className="mr-2 font-bold text-white/80">1.</span>
            Keep <strong className="font-semibold text-white/80">Pre-prod</strong> selected for Stripe test keys and PayTM staging credentials, then click{" "}
            <strong className="font-semibold text-white/80">Save Configuration</strong>.
          </li>
          <li>
            <span className="mr-2 font-bold text-white/80">2.</span>
            Click{" "}
            <strong className="font-semibold text-white/80">Test Connection</strong> — badge turns{" "}
            <span className="font-semibold text-emerald-300">Ready</span> on success.
          </li>
          <li>
            <span className="mr-2 font-bold text-white/80">3.</span>
            Set the gateway to <strong className="font-semibold text-white/80">Enabled</strong> and save again.
          </li>
          <li>
            <span className="mr-2 font-bold text-white/80">4.</span>
            On the Accounts page, open a verified account and click{" "}
            <strong className="font-semibold text-white/80">Initiate Payout</strong>.
          </li>
        </ol>
      </section>

      {/* ── Gateway panels ── */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/42">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading gateway configurations…
        </div>
      ) : (
        <>
          <StripePanel initial={configs.stripe} />
          <PaytmPanel  initial={configs.paytm} />
          <CashfreePanel initial={configs.cashfree} />
        </>
      )}

      {/* ── Payout ledger ── */}
      <PayoutHistory />
    </div>
  );
}
