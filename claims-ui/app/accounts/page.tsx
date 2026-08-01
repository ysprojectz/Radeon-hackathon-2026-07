"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Ban,
  CheckCircle2,
  CreditCard,
  DatabaseZap,
  Filter,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createCustomerAccount,
  getMe,
  initiateGatewayPayout,
  runCustomerAccountBankVerification,
  updateCustomerAccount,
  updateCustomerAccountGatewaySync,
  verifyCustomerAccount,
  type GetCustomerAccountsParams,
} from "@/lib/api";
import { useCustomerAccounts } from "@/lib/hooks/useCustomerAccounts";
import { cn } from "@/lib/utils";
import type {
  AccountVerificationStatus,
  CustomerAccount,
  CustomerAccountCreate,
  CustomerAccountType,
} from "@/lib/types";

const PAGE_SIZE = 20;
const MARKETS = ["ALL", "UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"];
const STATUSES: Array<AccountVerificationStatus | "ALL"> = ["ALL", "UNVERIFIED", "PENDING", "VERIFIED", "FAILED", "BLOCKED"];
const ACCOUNT_TYPES: CustomerAccountType[] = ["SAVINGS", "CURRENT", "CHECKING", "NRE", "NRO", "WALLET", "UPI", "OTHER"];
const ACCOUNT_CONTROL_ROLES = new Set(["ADMIN", "SENIOR_ADJUSTER", "COMPLIANCE_OFFICER"]);
// Roles whose accounts span all regions — they see the "ALL" option in the market filter.
const GLOBAL_VIEW_ROLES = new Set(["ADMIN", "SENIOR_ADJUSTER", "COMPLIANCE_OFFICER", "MEDICAL_DIRECTOR"]);

const inputClass =
  "h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-card)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-brand-primary";
const labelClass = "ui-control-label mb-1.5 block text-[var(--text-secondary)]";

function makeEmptyForm(marketRegion = "UAE"): CustomerAccountCreate {
  return {
    member_number: "",
    patient_name: "",
    market_region: marketRegion,
    account_holder_name: "",
    account_type: "SAVINGS",
    bank_name: "",
    iban: "",
    swift_bic: "",
    account_number: "",
    ifsc_code: "",
    upi_vpa: "",
    upi_provider: "",
    capture_source: "MANUAL",
    is_primary: true,
    notes: "",
  };
}

function formatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Semantic only (DESIGN_SYSTEM.md §1.2) — status tokens, not decorative hues.
function statusTone(status: AccountVerificationStatus) {
  if (status === "VERIFIED") return "border-[rgba(5,150,105,0.25)] bg-[rgba(5,150,105,0.10)] text-[var(--status-success)]";
  if (status === "PENDING") return "border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.10)] text-[var(--status-warning)]";
  if (status === "FAILED") return "border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)]";
  if (status === "BLOCKED") return "border-[rgba(220,38,38,0.30)] bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)]";
  return "border-[var(--border-subtle)] bg-[var(--bg-card-muted)] text-[var(--text-muted)]";
}

function gatewayTone(status: string) {
  if (status === "SYNCED") return "text-[var(--status-success)]";
  if (status === "SYNCING") return "text-[var(--status-warning)]";
  if (status === "SYNC_FAILED") return "text-[var(--status-danger)]";
  return "text-[var(--text-muted)]";
}

function paymentRail(account: CustomerAccount) {
  if (account.iban) return { label: "IBAN", value: account.iban };
  if (account.upi_vpa) return { label: "UPI", value: account.upi_vpa };
  if (account.account_number_last4) return { label: "Bank", value: `•••• ${account.account_number_last4}` };
  return { label: "Rail", value: "Not captured" };
}

function captureSourceLabel(source: CustomerAccount["capture_source"]) {
  const labels: Record<CustomerAccount["capture_source"], string> = {
    OCR_AUTO: "OCR Auto",
    OCR_REVIEWED: "OCR Reviewed",
    MANUAL: "Manual",
    ADVANCE_PROCESSING: "Pre Auth Processing",
    PATIENT_PORTAL: "Patient Portal",
  };
  return labels[source] ?? source;
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof ShieldCheck; tone: string }) {
  return (
    <div className="glass-card min-w-0 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="ui-eyebrow text-white/30">{label}</p>
          <p className="mt-2 text-2xl font-bold text-white">{value.toLocaleString()}</p>
        </div>
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border", tone)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function AccountFormDialog({
  open,
  onOpenChange,
  onCreated,
  defaultMarket = "UAE",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  defaultMarket?: string;
}) {
  const [form, setForm] = useState<CustomerAccountCreate>(() => makeEmptyForm(defaultMarket));
  const [saving, setSaving] = useState(false);
  const isIndia = form.market_region === "INDIA";

  // Reset to the user's region each time the dialog opens
  useEffect(() => {
    if (open) setForm(makeEmptyForm(defaultMarket));
  }, [open, defaultMarket]);

  const setField = <K extends keyof CustomerAccountCreate>(key: K, value: CustomerAccountCreate[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        iban: isIndia ? undefined : form.iban,
        account_number: isIndia ? form.account_number : undefined,
        ifsc_code: isIndia ? form.ifsc_code : undefined,
        upi_vpa: isIndia ? form.upi_vpa : undefined,
      };
      await createCustomerAccount(payload);
      toast.success("Payout account created");
      setForm(makeEmptyForm(defaultMarket));
      onCreated();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-white">Create payout account</DialogTitle>
            <DialogDescription>Capture bank account details for a member payout account.</DialogDescription>
          </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              <span className={labelClass}>Member Number</span>
              <input required value={form.member_number} onChange={(e) => setField("member_number", e.target.value)} className={inputClass} placeholder="MEM-UAE-001" />
            </label>
            <label>
              <span className={labelClass}>Claim Reference</span>
              <input value={form.claim_reference ?? ""} onChange={(e) => setField("claim_reference", e.target.value)} className={inputClass} placeholder="Optional source claim" />
            </label>
            <label>
              <span className={labelClass}>Patient Name</span>
              <input required value={form.patient_name} onChange={(e) => setField("patient_name", e.target.value)} className={inputClass} placeholder="Patient legal name" />
            </label>
            <label>
              <span className={labelClass}>Account Holder</span>
              <input required value={form.account_holder_name} onChange={(e) => setField("account_holder_name", e.target.value)} className={inputClass} placeholder="Name on account" />
            </label>
            <label>
              <span className={labelClass}>Market</span>
              <select value={form.market_region} onChange={(e) => setField("market_region", e.target.value)} className={inputClass}>
                {MARKETS.filter((m) => m !== "ALL").map((market) => <option key={market}>{market}</option>)}
              </select>
            </label>
            <label>
              <span className={labelClass}>Account Type</span>
              <select value={form.account_type} onChange={(e) => setField("account_type", e.target.value as CustomerAccountType)} className={inputClass}>
                {ACCOUNT_TYPES.map((type) => <option key={type}>{type}</option>)}
              </select>
            </label>
            <label>
              <span className={labelClass}>Bank Name</span>
              <input value={form.bank_name ?? ""} onChange={(e) => setField("bank_name", e.target.value)} className={inputClass} placeholder="Bank or wallet provider" />
            </label>
            <label>
              <span className={labelClass}>SWIFT/BIC</span>
              <input value={form.swift_bic ?? ""} onChange={(e) => setField("swift_bic", e.target.value.toUpperCase())} className={inputClass} placeholder="Optional" />
            </label>
            {isIndia ? (
              <>
                <label>
                  <span className={labelClass}>Account Number</span>
                  <input value={form.account_number ?? ""} onChange={(e) => setField("account_number", e.target.value)} className={inputClass} placeholder="Stored masked/encrypted" />
                </label>
                <label>
                  <span className={labelClass}>IFSC Code</span>
                  <input value={form.ifsc_code ?? ""} onChange={(e) => setField("ifsc_code", e.target.value.toUpperCase())} className={inputClass} placeholder="HDFC0001234" />
                </label>
                <label className="sm:col-span-2">
                  <span className={labelClass}>UPI/VPA Alternative</span>
                  <input value={form.upi_vpa ?? ""} onChange={(e) => setField("upi_vpa", e.target.value)} className={inputClass} placeholder="name@paytm" />
                </label>
              </>
            ) : (
              <label className="sm:col-span-2">
                <span className={labelClass}>IBAN</span>
                <input required value={form.iban ?? ""} onChange={(e) => setField("iban", e.target.value.toUpperCase().replace(/\s+/g, ""))} className={inputClass} placeholder="AE070331234567890123456" />
              </label>
            )}
            <label className="sm:col-span-2">
              <span className={labelClass}>Notes</span>
              <textarea value={form.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} className={cn(inputClass, "min-h-24 py-3")} placeholder="Verification notes or source context" />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => onOpenChange(false)} className="ui-button-secondary h-11 rounded-xl px-4 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={saving} className="ui-button-primary h-11 rounded-xl px-4 text-sm font-semibold">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Save Account
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AccountsPage() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  // market starts as null — fetching is suspended until we know the user's region
  const [market, setMarket] = useState<string | null>(null);
  const [status, setStatus] = useState<AccountVerificationStatus | "ALL">(() => {
    const value = searchParams.get("status");
    return STATUSES.includes(value as AccountVerificationStatus | "ALL") ? value as AccountVerificationStatus | "ALL" : "ALL";
  });
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<CustomerAccount | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [userMarket, setUserMarket] = useState<string>("UAE");
  const [payoutAmount, setPayoutAmount] = useState("");
  const [payoutCurrency, setPayoutCurrency] = useState("AED");
  const canControlAccounts = currentRole ? ACCOUNT_CONTROL_ROLES.has(currentRole) : false;
  const isGlobalRole = currentRole ? GLOBAL_VIEW_ROLES.has(currentRole) : false;
  // Markets shown in filter — global roles see all, regional roles stay pinned to their own region.
  const visibleMarkets = isGlobalRole ? MARKETS : MARKETS.filter((m) => m === userMarket);

  const params = useMemo<GetCustomerAccountsParams>(() => ({
    page,
    page_size: PAGE_SIZE,
    market_region: market ?? undefined,
    verification_status: status,
    search: search.trim() || undefined,
  }), [market, page, search, status]);
  // Suspend fetching until user region is resolved (market !== null)
  const { data, isLoading, isValidating, error, refresh } = useCustomerAccounts(params, { enabled: market !== null });
  const accounts = data?.accounts ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const summary = data?.summary;
  const refreshInProgress = manualRefreshing || (isValidating && !isLoading);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((user) => {
        if (!cancelled) {
          setCurrentRole(user.role);
          setUserMarket(user.market_region || "UAE");
          // Global roles start on ALL; regional roles start on their own market
          const isGlobal = GLOBAL_VIEW_ROLES.has(user.role);
          setMarket(isGlobal ? "ALL" : (user.market_region || "UAE"));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentRole(null);
          setMarket("UAE");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function runAction(account: CustomerAccount, action: "verify" | "bank-verify" | "block" | "primary" | "stripe" | "paytm" | "cashfree") {
    setActionId(`${account.id}:${action}`);
    try {
      if (action === "verify") await verifyCustomerAccount(account.id, "VERIFIED", "Verified from accounts workbench");
      if (action === "bank-verify") {
        const updated = await runCustomerAccountBankVerification(account.id);
        setSelected(updated);
      }
      if (action === "block") await verifyCustomerAccount(account.id, "BLOCKED", "Blocked from accounts workbench");
      if (action === "primary") await updateCustomerAccount(account.id, { is_primary: true });
      if (action === "stripe") await updateCustomerAccountGatewaySync(account.id, "stripe", "SYNCED");
      if (action === "paytm") await updateCustomerAccountGatewaySync(account.id, "paytm", "SYNCED");
      if (action === "cashfree") await updateCustomerAccountGatewaySync(account.id, "cashfree", "SYNCED");
      toast.success(action === "bank-verify" ? "Bank verification completed" : "Account updated");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Account update failed");
    } finally {
      setActionId(null);
    }
  }

  async function initiatePayout(account: CustomerAccount, gateway: "stripe" | "paytm") {
    const amount = Number(payoutAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid payout amount");
      return;
    }
    setActionId(`${account.id}:payout:${gateway}`);
    try {
      const payout = await initiateGatewayPayout({
        account_id: account.id,
        gateway,
        amount_minor: Math.round(amount * 100),
        currency: payoutCurrency.toUpperCase(),
        claim_reference: account.claim_reference || undefined,
        description: account.claim_reference
          ? `Claim settlement payout for ${account.claim_reference}`
          : `Manual settlement payout for ${account.member_number}`,
      });
      toast.success(`Payout ${payout.status.toLowerCase()} via ${gateway}`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Payout initiation failed");
    } finally {
      setActionId(null);
    }
  }

  const handleRefresh = useCallback(async () => {
    if (market === null || refreshInProgress) return;
    setManualRefreshing(true);
    try {
      await refresh();
      toast.success("Accounts refreshed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refresh accounts");
    } finally {
      setManualRefreshing(false);
    }
  }, [market, refresh, refreshInProgress]);

  return (
    <div className="acos-page">
      <PageHeader
        title="Accounts"
      />

      <section className="glass-card overflow-hidden px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] text-[var(--text-secondary)]">
              <Landmark className="h-5 w-5" />
            </span>
            <div>
              <p className="ui-eyebrow text-white/30">Payout Registry</p>
              <h2 className="text-lg font-semibold text-white">Customer account operations</h2>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={market === null || refreshInProgress}
              aria-busy={refreshInProgress}
              className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {refreshInProgress ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {refreshInProgress ? "Refreshing" : "Refresh"}
            </button>
            {canControlAccounts && (
              <button onClick={() => setCreateOpen(true)} className="ui-button-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold">
                <Plus className="h-4 w-4" />
                New Account
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Verified" value={summary?.VERIFIED ?? 0} icon={ShieldCheck} tone="border-[rgba(5,150,105,0.25)] bg-[rgba(5,150,105,0.10)] text-[var(--status-success)]" />
        <SummaryCard label="Pending" value={summary?.PENDING ?? 0} icon={DatabaseZap} tone="border-[rgba(217,119,6,0.25)] bg-[rgba(217,119,6,0.10)] text-[var(--status-warning)]" />
        <SummaryCard label="Unverified" value={summary?.UNVERIFIED ?? 0} icon={CreditCard} tone="border-[var(--border-subtle)] bg-[var(--bg-card-muted)] text-[var(--text-secondary)]" />
        <SummaryCard label="Blocked" value={summary?.BLOCKED ?? 0} icon={Ban} tone="border-[rgba(220,38,38,0.25)] bg-[rgba(220,38,38,0.10)] text-[var(--status-danger)]" />
      </div>

      <section className="glass-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <label className="relative block">
            <span className="sr-only">Search accounts</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className={cn(inputClass, "pl-10")} placeholder="Search member, patient, holder, or claim" />
          </label>
          <label>
            <span className="sr-only">Market</span>
            <select value={market ?? ""} onChange={(e) => { setMarket(e.target.value); setPage(1); }} className={inputClass}>
              {visibleMarkets.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Verification status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value as AccountVerificationStatus | "ALL"); setPage(1); }} className={inputClass}>
              {STATUSES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="glass-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-white/35" />
            <p className="ui-eyebrow text-white/30">{data?.total ?? 0} Accounts</p>
          </div>
          <p className="text-xs text-white/36">Page {page} of {totalPages}</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-white/42">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading accounts
          </div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-300">Failed to load accounts</div>
        ) : accounts.length === 0 ? (
          <div className="p-10 text-center">
            <CreditCard className="mx-auto h-10 w-10 text-white/24" />
            <p className="mt-3 text-sm font-semibold text-white/74">No payout accounts found</p>
            <p className="mt-1 text-xs text-white/36">Create one manually or upload claim documents with reimbursement details.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-[var(--bg-card-muted)] text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Account</th>
                  <th className="px-5 py-3 font-semibold">Rail</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  <th className="px-5 py-3 font-semibold">Gateway</th>
                  <th className="px-5 py-3 font-semibold">Updated</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {accounts.map((account) => {
                  const rail = paymentRail(account);
                  return (
                    <tr key={account.id} className="transition-colors hover:bg-white/[0.025]">
                      <td className="px-5 py-4">
                        <button onClick={() => setSelected(account)} className="text-left">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold text-white">{account.account_holder_name}</p>
                            {account.is_primary && <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" />}
                          </div>
                          <p className="mt-1 text-xs text-white/42">{account.patient_name} · {account.member_number}</p>
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-white/82">{rail.value}</p>
                        <p className="mt-1 text-xs text-white/36">{rail.label} · {account.market_region} · {account.bank_name || "No bank name"}</p>
                      </td>
                      <td className="px-5 py-4">
                        <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(account.verification_status))}>
                          {account.verification_status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs">
                        <p className={gatewayTone(account.stripe_sync_status)}>Stripe: {account.stripe_sync_status}</p>
                        <p className={cn("mt-1", gatewayTone(account.paytm_sync_status))}>PayTM: {account.paytm_sync_status}</p>
                        <p className={cn("mt-1", gatewayTone(account.cashfree_sync_status))}>Cashfree: {account.cashfree_sync_status}</p>
                      </td>
                      <td className="px-5 py-4 text-xs text-white/42">{formatDate(account.updated_at)}</td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-2">
                          {canControlAccounts && (
                            <button onClick={() => runAction(account, "verify")} disabled={!!actionId} className="ui-button-secondary rounded-xl p-2 text-emerald-300" title="Verify">
                              {actionId === `${account.id}:verify` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            </button>
                          )}
                          {canControlAccounts && (
                            <button onClick={() => runAction(account, "primary")} disabled={!!actionId || account.is_primary} className="ui-button-secondary rounded-xl p-2 text-amber-300 disabled:opacity-40" title="Set primary">
                              <Star className="h-4 w-4" />
                            </button>
                          )}
                          {canControlAccounts && (
                            <button onClick={() => runAction(account, "block")} disabled={!!actionId} className="ui-button-secondary rounded-xl p-2 text-red-300" title="Block">
                              {actionId === `${account.id}:block` ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                            </button>
                          )}
                          {account.verification_status === "VERIFIED" && (account.stripe_sync_status === "SYNCED" || account.paytm_sync_status === "SYNCED" || account.cashfree_sync_status === "SYNCED") && (
                            <button onClick={() => setSelected(account)} className="ui-button-secondary rounded-xl p-2 text-brand-primary" title="Initiate payout">
                              <CreditCard className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-white/[0.06] px-5 py-4">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="ui-button-secondary rounded-xl px-3 py-2 text-sm disabled:opacity-40">Previous</button>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="ui-button-secondary rounded-xl px-3 py-2 text-sm disabled:opacity-40">Next</button>
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">{selected.account_holder_name}</DialogTitle>
                <DialogDescription>Review payout account verification and gateway provider status.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Member", selected.member_number],
                  ["Patient", selected.patient_name],
                  ["Claim", selected.claim_reference || "Manual capture"],
                  ["Market", selected.market_region],
                  ["Capture", captureSourceLabel(selected.capture_source)],
                  ["OCR Confidence", selected.ocr_confidence == null ? "Manual" : `${Math.round(selected.ocr_confidence * 100)}%`],
                  ["Verified By", selected.verified_by || "Not verified"],
                  ["Created", formatDate(selected.created_at)],
                ].map(([label, value]) => (
                  <div key={label} className="glass-card px-4 py-3">
                    <p className="ui-eyebrow text-white/28">{label}</p>
                    <p className="mt-2 text-sm font-semibold text-white/82">{value}</p>
                  </div>
                ))}
              </div>
              {canControlAccounts && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <button onClick={() => runAction(selected, "bank-verify")} className="ui-button-primary rounded-xl px-3 py-2 text-sm">
                    {actionId === `${selected.id}:bank-verify` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Verify Bank
                  </button>
                  <button onClick={() => runAction(selected, "stripe")} className="ui-button-secondary rounded-xl px-3 py-2 text-sm">Mark Stripe Synced</button>
                  <button onClick={() => runAction(selected, "paytm")} className="ui-button-secondary rounded-xl px-3 py-2 text-sm">Mark PayTM Synced</button>
                  <button onClick={() => runAction(selected, "cashfree")} className="ui-button-secondary rounded-xl px-3 py-2 text-sm">Mark Cashfree Synced</button>
                </div>
              )}
              {selected.latest_verification_attempt && (
                <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="ui-eyebrow text-white/28">Bank Verification</p>
                      <p className="mt-2 text-sm font-semibold text-white/82">
                        {selected.latest_verification_attempt.provider.toUpperCase()} · {selected.latest_verification_attempt.status}
                      </p>
                      <p className="mt-1 text-xs text-white/42">{selected.latest_verification_attempt.status_reason || "No provider message"}</p>
                    </div>
                    <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", statusTone(selected.latest_verification_attempt.status))}>
                      {selected.latest_verification_attempt.environment}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="ui-eyebrow text-white/24">Bank</p>
                      <p className="mt-1 text-xs text-white/70">{selected.latest_verification_attempt.bank_name || selected.bank_name || "Not returned"}</p>
                    </div>
                    <div>
                      <p className="ui-eyebrow text-white/24">Holder Match</p>
                      <p className="mt-1 text-xs text-white/70">
                        {selected.latest_verification_attempt.holder_match_score == null
                          ? "Not returned"
                          : `${Math.round(selected.latest_verification_attempt.holder_match_score * 100)}%`}
                      </p>
                    </div>
                    <div>
                      <p className="ui-eyebrow text-white/24">Verified At</p>
                      <p className="mt-1 text-xs text-white/70">{formatDate(selected.latest_verification_attempt.created_at)}</p>
                    </div>
                  </div>
                </div>
              )}
              {canControlAccounts && selected.verification_status === "VERIFIED" && (
                <div className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                    <label className="flex-1">
                      <span className={labelClass}>Payout Amount</span>
                      <input value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} className={inputClass} inputMode="decimal" placeholder="Settlement amount" />
                    </label>
                    <label className="w-full lg:w-28">
                      <span className={labelClass}>Currency</span>
                      <input value={payoutCurrency} onChange={(e) => setPayoutCurrency(e.target.value.toUpperCase().slice(0, 3))} className={inputClass} placeholder="AED" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => initiatePayout(selected, "stripe")}
                        disabled={!!actionId || selected.stripe_sync_status !== "SYNCED"}
                        className="ui-button-primary h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
                      >
                        {actionId === `${selected.id}:payout:stripe` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        Stripe Payout
                      </button>
                      <button
                        onClick={() => initiatePayout(selected, "paytm")}
                        disabled={!!actionId || selected.paytm_sync_status !== "SYNCED"}
                        className="ui-button-secondary h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-40"
                      >
                        {actionId === `${selected.id}:payout:paytm` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        PayTM Payout
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-white/36">
                    This closes the post-settlement stage by creating a gateway payout record for the linked claim.
                  </p>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AccountFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refresh()} defaultMarket={userMarket} />
    </div>
  );
}
