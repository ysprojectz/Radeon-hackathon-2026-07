"use client";

import {
  BadgeDollarSign,
  Calculator,
  FileText,
  Percent,
  ReceiptText,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { parseDecimal } from "@/lib/utils";
import type { ClaimLineItemResponse, ClaimResponse, SettlementResponse } from "@/lib/types";

interface SettlementBreakdownProps {
  settlement: SettlementResponse;
  claim?: ClaimResponse;
}

type LedgerTone = "default" | "deduction" | "positive" | "final" | "info";

export function SettlementBreakdown({ settlement: s, claim }: SettlementBreakdownProps) {
  const currency = s.currency || claim?.currency || "INR";
  const billed = amount(s.total_billed);
  const allowed = amount(s.total_allowed);
  const planPayment = amount(s.total_plan_payment);
  const memberShare = amount(s.total_member_responsibility);
  const deductible = amount(s.total_deductible);
  const copay = amount(s.total_copay);
  const coinsurance = amount(s.total_coinsurance_member);
  const vat = amount(s.total_vat);
  const gst = amount(s.total_gst);
  const tds = amount(s.total_tds);
  const netPayout = amount(s.net_payout);
  const networkAdjustment = Math.max(0, billed - allowed);
  const taxTracked = vat + gst;
  const overallTotal = planPayment + memberShare;
  const lineItems = s.line_items?.length ? s.line_items : claim?.line_items ?? [];
  const copayRate = rateFromSteps(lineItems, ["COPAY", "ZONAL_COPAY"]) ?? effectiveRate(copay, allowed);
  const vatRate = rateFromSteps(lineItems, ["VAT_TRACKING"]);
  const gstRate = rateFromSteps(lineItems, ["GST_TRACKING"]) ?? stringValue(s.calculation_breakdown?.consumables_gst_pct, "%");
  const tdsRate = stringValue(s.calculation_breakdown?.tds_rate_pct, "%");
  const settlementModel = friendlyModel(s.calculation_breakdown?.model);
  const policyTier = stringValue(s.calculation_breakdown?.policy_tier);
  const networkRemark = buildNetworkRemark(claim?.network_tier, networkAdjustment, currency);
  const copayRemark = copay > 0
    ? `Member copay applied at ${copayRate ?? "the policy rate"} across eligible services.`
    : "No copay was applied on eligible services.";
  const taxRemark = taxTracked > 0
    ? `${vat > 0 ? `VAT ${vatRate ?? ""}` : ""}${vat > 0 && gst > 0 ? " and " : ""}${gst > 0 ? `GST ${gstRate ?? ""}` : ""} tracked for reporting; embedded tax is not added again to settlement.`
    : "No tax amount was added to the payable settlement.";

  const ledgerRows = [
    { label: "Gross billed by provider", amount: billed, tone: "default" as LedgerTone },
    ...(networkAdjustment > 0
      ? [{ label: "Network / fee schedule adjustment", amount: -networkAdjustment, tone: "deduction" as LedgerTone, note: "Difference between billed and allowed." }]
      : []),
    { label: "Allowed after review", amount: allowed, tone: "info" as LedgerTone },
    ...(deductible > 0
      ? [{ label: "Deductible applied", amount: -deductible, tone: "deduction" as LedgerTone }]
      : []),
    ...(copay > 0
      ? [{ label: `Copay${copayRate ? ` (${copayRate})` : ""}`, amount: -copay, tone: "deduction" as LedgerTone }]
      : []),
    ...(coinsurance > 0
      ? [{ label: "Coinsurance paid by member", amount: -coinsurance, tone: "deduction" as LedgerTone }]
      : []),
    { label: "Plan payment before withholding", amount: planPayment, tone: "positive" as LedgerTone },
    ...(taxTracked > 0
      ? [{ label: `Tax tracked${vatRate || gstRate ? ` (${[vatRate, gstRate].filter(Boolean).join(" / ")})` : ""}`, amount: taxTracked, tone: "info" as LedgerTone, note: "Tracked for compliance reporting." }]
      : []),
    ...(tds > 0
      ? [{ label: `Withholding / TDS${tdsRate ? ` (${tdsRate})` : ""}`, amount: -tds, tone: "deduction" as LedgerTone }]
      : []),
    ...(netPayout > 0
      ? [{ label: "Net payout after withholding", amount: netPayout, tone: "positive" as LedgerTone }]
      : []),
    { label: "Overall adjudicated total", amount: overallTotal, tone: "final" as LedgerTone, note: "Plan payment plus member responsibility." },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="glass-card rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
                <ReceiptText className="h-4 w-4" />
              </span>
              <div>
                <p className="ui-eyebrow text-white/30">Adjudication</p>
                <h3 className="text-sm font-bold text-white">Settlement Ledger</h3>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {settlementModel && <Pill label={settlementModel} />}
              {policyTier && <Pill label={`${policyTier} policy`} />}
              <Pill label={currency} />
            </div>
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total billed" amount={billed} currency={currency} />
            <Metric label="Allowed" amount={allowed} currency={currency} />
            <Metric label="Plan pays" amount={planPayment} currency={currency} tone="positive" />
            <Metric label="Member pays" amount={memberShare} currency={currency} tone="warning" />
          </div>

          <div className="space-y-1.5">
            {ledgerRows.map((row) => (
              <LedgerRow
                key={row.label}
                label={row.label}
                note={row.note}
                value={row.amount}
                currency={currency}
                tone={row.tone}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <SummaryTile
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Plan Payment"
            amount={planPayment}
            currency={currency}
            tone="emerald"
          />
          <SummaryTile
            icon={<WalletCards className="h-4 w-4" />}
            label="Member Responsibility"
            amount={memberShare}
            currency={currency}
            tone="amber"
          />
          {taxTracked > 0 && (
            <SummaryTile
              icon={<Percent className="h-4 w-4" />}
              label="Tax Tracked"
              amount={taxTracked}
              currency={currency}
              tone="cyan"
              sublabel={[vat > 0 && `VAT ${vatRate ?? ""}`, gst > 0 && `GST ${gstRate ?? ""}`].filter(Boolean).join(" / ")}
            />
          )}
          {netPayout > 0 && (
            <SummaryTile
              icon={<BadgeDollarSign className="h-4 w-4" />}
              label="Net Payout"
              amount={netPayout}
              currency={currency}
              tone="emerald"
              sublabel={tds > 0 ? `After withholding ${tdsRate ?? ""}` : undefined}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <div className="glass-card rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <p className="ui-eyebrow text-white/30">Decision remarks</p>
              <h3 className="text-sm font-bold text-white">What Changed The Payable Amount</h3>
            </div>
          </div>
          <div className="space-y-2">
            <Remark title="Network review" text={networkRemark} />
            <Remark title="Copay" text={copayRemark} />
            <Remark title="Tax" text={taxRemark} />
            {tds > 0 && <Remark title="Provider payout" text={`Withholding of ${tdsRate ?? "the configured rate"} is deducted before net payout.`} />}
          </div>
        </div>

        <div className="glass-card overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.025]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] px-4 py-3">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-brand-primary" />
              <h3 className="text-sm font-bold text-white">Line-Level Settlement</h3>
            </div>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
              {lineItems.length > 0 ? `${lineItems.length} lines` : "Claim summary"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.8fr_1.4fr] border-b border-white/[0.08] bg-white/[0.035] px-4 py-2">
                {["Service", "Billed", "Allowed", "Copay", "Plan", "Remark"].map((h) => (
                  <span key={h} className="px-1 text-[10px] font-bold uppercase tracking-widest text-white/35">
                    {h}
                  </span>
                ))}
              </div>
              {lineItems.length > 0 ? (
                <>
                  <div className="divide-y divide-white/[0.055]">
                    {lineItems.slice(0, 8).map((item) => (
                      <LineSettlementRow key={item.line_number} item={item} currency={currency} />
                    ))}
                  </div>
                  {lineItems.length > 8 && (
                    <div className="px-4 py-2 text-xs text-white/38">
                      Showing first 8 lines. Full line audit remains available in the Line Items tab.
                    </div>
                  )}
                </>
              ) : (
                <ClaimSummaryRow
                  billed={billed}
                  allowed={allowed}
                  copay={copay}
                  planPayment={planPayment}
                  currency={currency}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function amount(value: number | string | undefined | null): number {
  return parseDecimal(value ?? "0");
}

function stringValue(value: unknown, suffix = ""): string | undefined {
  if (value == null || value === "") return undefined;
  const raw = String(value);
  return suffix && !raw.endsWith(suffix) ? `${raw}${suffix}` : raw;
}

function friendlyModel(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  return raw.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function rateFromSteps(items: ClaimLineItemResponse[], stepNames: string[]): string | undefined {
  for (const item of items) {
    for (const step of item.calculation_steps ?? []) {
      const stepName = String(step.step ?? "");
      if (stepNames.some((name) => stepName.includes(name)) && step.rate != null) {
        return String(step.rate);
      }
    }
  }
  return undefined;
}

function effectiveRate(numerator: number, denominator: number): string | undefined {
  if (numerator <= 0 || denominator <= 0) return undefined;
  return `${((numerator / denominator) * 100).toFixed(1)}% effective`;
}

function buildNetworkRemark(networkTier: string | undefined, adjustment: number, currency: string): string {
  const tier = (networkTier || "").replace(/_/g, " ").trim();
  const normalized = tier.toUpperCase();
  if (normalized.includes("OUT") || normalized.includes("NON") || normalized.includes("UNLISTED")) {
    return `${tier || "Non-listed network"} provider used. Allowed amount may be reduced and the member share can increase.`;
  }
  if (adjustment > 0) {
    return `Billed amount was reduced by the network or fee schedule adjustment (${currency} ${adjustment.toFixed(2)}).`;
  }
  return tier ? `${tier} provider accepted at the allowed amount.` : "No network reduction was applied.";
}

function itemTax(item: ClaimLineItemResponse): number {
  for (const step of item.calculation_steps ?? []) {
    if (step.step === "VAT_TRACKING") return amount(step.estimated_vat_portion as string | number | undefined);
    if (step.step === "GST_TRACKING") return amount(step.estimated_gst as string | number | undefined);
  }
  return 0;
}

function itemRemark(item: ClaimLineItemResponse, currency: string): string {
  if (item.is_covered === false) return item.denial_reason || "Denied by policy rules.";
  if (item.sub_limit_applied) return item.sub_limit_name ? `Sub-limit applied: ${item.sub_limit_name}.` : "Sub-limit applied.";

  for (const step of item.calculation_steps ?? []) {
    const name = String(step.step ?? "");
    if (name === "COPAY_NETWORK_TIER") {
      return `Network-tier copay ${step.rate ?? ""}${step.cap ? `; cap ${currency} ${step.cap}` : ""}.`;
    }
    if (name === "ZONAL_COPAY") return `Zonal copay ${step.rate ?? ""} applied.`;
    if (name === "COPAY_CONSULTATION" || name === "COPAY_DIAGNOSTIC" || name === "COPAY_PHARMACY") {
      return `Copay ${step.rate ?? ""} applied${step.cap ? ` with cap ${currency} ${step.cap}` : ""}.`;
    }
    if (name === "VAT_TRACKING") return `VAT ${step.rate ?? ""} tracked inside billed amount.`;
    if (name === "GST_TRACKING") return `GST ${step.rate ?? ""} tracked for consumables.`;
    if (name === "VAT_EXEMPT") return "Tax exempt service.";
  }

  const adjustment = amount(item.billed_amount) - amount(item.allowed_amount);
  if (adjustment > 0) return `Allowed amount reduced by ${currency} ${adjustment.toFixed(2)}.`;
  return "Covered at allowed amount.";
}

function Pill({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/45">
      {label}
    </span>
  );
}

function Metric({
  label,
  amount: value,
  currency,
  tone = "default",
}: {
  label: string;
  amount: number;
  currency: string;
  tone?: "default" | "positive" | "warning";
}) {
  const color = tone === "positive" ? "text-emerald-300" : tone === "warning" ? "text-amber-300" : "text-white/88";
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5">
      <p className="ui-eyebrow mb-1 text-white/30">{label}</p>
      <CurrencyAmount amount={value} currency={currency} bold className={`font-mono text-sm ${color}`} />
    </div>
  );
}

function LedgerRow({
  label,
  note,
  value,
  currency,
  tone,
}: {
  label: string;
  note?: string;
  value: number;
  currency: string;
  tone: LedgerTone;
}) {
  const toneClass = {
    default: "text-white/82",
    deduction: "text-red-300",
    positive: "text-emerald-300",
    final: "text-brand-primary",
    info: "text-blue-200",
  }[tone];

  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${tone === "final" ? "border-brand-primary/20 bg-brand-primary/[0.08]" : "border-white/[0.07] bg-white/[0.035]"}`}>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white/72">{label}</p>
        {note && <p className="mt-0.5 text-[11px] text-white/35">{note}</p>}
      </div>
      <span className={`shrink-0 font-mono text-sm font-bold tabular-nums ${toneClass}`}>
        {value < 0 ? "- " : ""}
        <CurrencyAmount amount={Math.abs(value)} currency={currency} />
      </span>
    </div>
  );
}

function Remark({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] p-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-white/35">{title}</p>
      <p className="text-sm leading-relaxed text-white/68">{text}</p>
    </div>
  );
}

function LineSettlementRow({ item, currency }: { item: ClaimLineItemResponse; currency: string }) {
  return (
    <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.8fr_1.4fr] items-center px-4 py-3 text-sm">
      <div className="min-w-0 px-1">
        <p className="truncate font-mono text-xs font-bold text-brand-primary">{item.procedure_code || `Line ${item.line_number}`}</p>
        <p className="truncate text-[11px] text-white/42">{item.procedure_desc || item.service_category || "Service line"}</p>
      </div>
      <Money value={item.billed_amount} currency={currency} />
      <Money value={item.allowed_amount} currency={currency} />
      <Money value={item.copay_amount} currency={currency} tone="deduction" />
      <Money value={item.plan_paid} currency={currency} tone="positive" />
      <div className="px-1">
        <p className="line-clamp-2 text-xs leading-relaxed text-white/58">{itemRemark(item, currency)}</p>
        {itemTax(item) > 0 && (
          <p className="mt-0.5 text-[10px] font-semibold text-blue-200/70">
            Tax tracked: <CurrencyAmount amount={itemTax(item)} currency={currency} />
          </p>
        )}
      </div>
    </div>
  );
}

function ClaimSummaryRow({
  billed,
  allowed,
  copay,
  planPayment,
  currency,
}: {
  billed: number;
  allowed: number;
  copay: number;
  planPayment: number;
  currency: string;
}) {
  return (
    <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.8fr_1.4fr] items-center px-4 py-3 text-sm">
      <div className="min-w-0 px-1">
        <p className="font-mono text-xs font-bold text-brand-primary">Claim total</p>
        <p className="text-[11px] text-white/42">Claim-level settlement</p>
      </div>
      <Money value={billed} currency={currency} />
      <Money value={allowed} currency={currency} />
      <Money value={copay} currency={currency} tone="deduction" />
      <Money value={planPayment} currency={currency} tone="positive" />
      <p className="px-1 text-xs leading-relaxed text-white/58">
        Service-line detail was not captured for this older claim. New processed claims show each line with copay, tax, and remarks here.
      </p>
    </div>
  );
}

function Money({
  value,
  currency,
  tone = "default",
}: {
  value: number | string | undefined;
  currency: string;
  tone?: "default" | "deduction" | "positive";
}) {
  const color = tone === "positive" ? "text-emerald-300/90" : tone === "deduction" ? "text-amber-200/90" : "text-white/72";
  return (
    <span className={`px-1 text-right font-mono text-xs font-semibold tabular-nums ${color}`}>
      <CurrencyAmount amount={value ?? 0} currency={currency} />
    </span>
  );
}

function SummaryTile({
  icon,
  label,
  amount,
  currency,
  tone,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  amount: number | string;
  currency: string;
  tone: "emerald" | "amber" | "cyan";
  sublabel?: string;
}) {
  const toneClass = {
    emerald: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
    amber: "border-amber-400/20 bg-amber-400/[0.08] text-amber-300",
    cyan: "border-brand-primary/20 bg-brand-primary/[0.08] text-brand-primary",
  }[tone];

  return (
    <div className={`glass-card rounded-2xl border p-4 ${toneClass}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-current/20 bg-black/10">
          {icon}
        </span>
        <span className="ui-eyebrow text-current/70">{label}</span>
      </div>
      <CurrencyAmount amount={amount} currency={currency} bold className="font-mono text-xl text-current" />
      {sublabel && <p className="mt-1 text-[11px] font-medium text-current/65">{sublabel}</p>}
    </div>
  );
}
