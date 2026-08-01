"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import Image from "next/image";
import { Save, ShieldCheck, Brain, Percent, BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { adminUpdateConfig } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";
import {
  adminActionButtonClass,
  adminInputClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
} from "@/components/admin/admin-theme";


// All models that can be used for approval decisions
const APPROVAL_MODELS = [
  { value: "qwen/qwen3-32b",               label: "Intelligence AI Agent - Fast" },
  { value: "llama-3.3-70b-versatile",      label: "Intelligence AI Agent - Large" },
  { value: "llama-3.1-8b-instant",         label: "Intelligence AI Agent - Instant" },
  { value: "claude-opus-4-5",              label: "Claude Opus 4.5 (Anthropic)" },
  { value: "claude-sonnet-4-5",            label: "Claude Sonnet 4.5 (Anthropic)" },
  { value: "claude-3-5-haiku-20241022",    label: "Claude 3.5 Haiku (Anthropic)" },
  { value: "gpt-4o",                       label: "GPT-4o (OpenAI)" },
  { value: "gpt-4o-mini",                  label: "GPT-4o Mini (OpenAI)" },
  { value: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Intelligence AI Agent - Advanced" },
  { value: "meta/llama-3.3-70b-instruct",             label: "Intelligence AI Agent - Enterprise" },
  { value: "nvidia/llama-3.1-nemotron-70b-instruct",  label: "Intelligence AI Agent - Balanced" },
];

const APPROVAL_MARKETS = [
  { value: "INDIA", label: "India", currency: "INR" },
];

// ── Section card wrapper ───────────────────────────────────────────────────────

function Section({
  title, description, icon: Icon, children,
}: {
  title: string;
  description: string;
  icon: React.FC<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className={`${adminPanelClass} overflow-hidden`}>
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <div className="rounded-xl border border-cyan-300/18 bg-cyan-300/10 p-2">
          <Icon className="h-4 w-4 text-cyan-100" />
        </div>
        <div>
          <p className={adminSectionTitleClass}>{title}</p>
          <p className={`mt-0.5 text-[11px] ${adminSectionCopyClass}`}>{description}</p>
        </div>
      </div>
      <div className="px-4 py-4 space-y-4">
        {children}
      </div>
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────

function FieldRow({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-4">
      <div className="space-y-0.5 min-w-0">
        <Label className="text-[12px] font-medium text-white/82">{label}</Label>
        {hint && <p className={`text-[11px] leading-relaxed ${adminSectionCopyClass}`}>{hint}</p>}
      </div>
      <div className="shrink-0 w-[160px]">{children}</div>
    </div>
  );
}

// ── Market VAT row ────────────────────────────────────────────────────────────

function VatRow({
  market, flag, value, onChange,
}: {
  market: string;
  flag: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2.5">
      <Image src={flag} alt="" width={24} height={16} className="rounded-sm object-cover shrink-0" aria-hidden="true" />
      <span className="flex-1 text-sm font-medium text-white/82">{market}</span>
      <div className="relative w-[90px]">
        <Input
          type="number" min={0} max={100} step={0.01}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${adminInputClass} h-8 pr-7 text-sm font-mono text-right`}
        />
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-white/35">%</span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props { config: SystemConfig | undefined; onSaved: () => void; }

export function ClaimApprovalTab({ config, onSaved }: Props) {
  // Auto-approval thresholds
  const [autoThreshold, setAutoThreshold] = useState("95");
  const [maxAmount,     setMaxAmount]     = useState("50000");
  const [selectedMarket, setSelectedMarket] = useState("INDIA");
  const [marketThresholds, setMarketThresholds] = useState<Record<string, { currency: string; max_amount: number }>>({});
  const [threshLoading, setThreshLoading] = useState(false);

  // LLM model
  const [approvalModel,   setApprovalModel]   = useState("qwen/qwen3-32b");
  const [modelLoading,    setModelLoading]    = useState(false);

  // GST rate
  const [gstIndia,  setGstIndia]  = useState("18.0");
  const [vatLoading, setVatLoading] = useState(false);

  useEffect(() => {
    if (!config) return;
    setAutoThreshold(String(config.claim_auto_approve_threshold ?? 95));
    const thresholds = config.claim_auto_approve_thresholds_by_market ?? {
      INDIA: { currency: "INR", max_amount: 1000000 },
    };
    setMarketThresholds(thresholds);
    setMaxAmount(String(thresholds[selectedMarket]?.max_amount ?? config.claim_auto_approve_max_amount ?? 50000));
    setApprovalModel(config.claim_approval_llm_model           ?? "qwen/qwen3-32b");
    setGstIndia(String(config.gst_rate_india ?? 18.0));
  }, [config, selectedMarket]);

  const selectedMarketCurrency =
    marketThresholds[selectedMarket]?.currency ??
    APPROVAL_MARKETS.find((market) => market.value === selectedMarket)?.currency ??
    "INR";

  function handleMarketChange(market: string) {
    setSelectedMarket(market);
    const configured = marketThresholds[market];
    setMaxAmount(String(configured?.max_amount ?? 0));
  }

  async function saveThresholds() {
    const amount = Number(maxAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Threshold amount must be a valid non-negative number");
      return;
    }
    const nextThresholds = {
      ...marketThresholds,
      [selectedMarket]: {
        currency: selectedMarketCurrency,
        max_amount: amount,
      },
    };
    setThreshLoading(true);
    try {
      await adminUpdateConfig({
        claim_auto_approve_threshold:   parseFloat(autoThreshold),
        claim_auto_approve_max_amount:  amount,
        claim_auto_approve_thresholds_by_market: nextThresholds,
      });
      setMarketThresholds(nextThresholds);
      toast.success("Auto-approval rules saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setThreshLoading(false);
    }
  }

  async function saveModel() {
    setModelLoading(true);
    try {
      await adminUpdateConfig({ claim_approval_llm_model: approvalModel });
      toast.success("Approval model saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setModelLoading(false);
    }
  }

  async function saveVatRates() {
    setVatLoading(true);
    try {
      await adminUpdateConfig({
        gst_rate_india: parseFloat(gstIndia),
      });
      toast.success("Tax rate saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setVatLoading(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">

      {/* ── Auto-Approval Rules ────────────────────────────────────────────── */}
      <Section
        title="Auto-Approval Rules"
        description="Claims meeting both criteria are settled automatically without manual review"
        icon={ShieldCheck}
      >
        <FieldRow
          label="Market"
          hint="Threshold currency follows the selected market automatically"
        >
          <Select value={selectedMarket} onValueChange={handleMarketChange}>
            <SelectTrigger className={`${adminInputClass} h-9 text-sm`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPROVAL_MARKETS.map((market) => (
                <SelectItem key={market.value} value={market.value}>
                  {market.label} ({market.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow
          label="Confidence threshold"
          hint="Minimum confidence score required for auto-approval (0-100)"
        >
          <div className="relative">
            <Input
              type="number" min={50} max={100} step={1}
              value={autoThreshold}
              onChange={(e) => setAutoThreshold(e.target.value)}
              className={`${adminInputClass} h-9 pr-7 text-sm font-mono`}
            />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-white/35">%</span>
          </div>
        </FieldRow>

        <FieldRow
          label="Max claim amount"
          hint="Claims above this amount always go to Final Approval, regardless of confidence"
        >
          <div className="relative">
            <Input
              type="number" min={0} step={1000}
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
              className={`${adminInputClass} h-9 pl-7 text-sm font-mono`}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-white/35">
              {selectedMarketCurrency}
            </span>
          </div>
        </FieldRow>

        <div className="pt-1">
          <div className="rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2 text-[11px] text-white/55">
            ℹ Auto-approve fires when: confidence ≥ <strong className="text-foreground">{autoThreshold}%</strong> AND
            total billed ≤ <strong className="text-foreground">{selectedMarketCurrency} {Number(maxAmount).toLocaleString()}</strong>
          </div>
        </div>

        <Button onClick={saveThresholds} disabled={threshLoading} size="sm" className={adminActionButtonClass}>
          <Save className="h-3.5 w-3.5" />
          {threshLoading ? "Saving…" : "Save Auto-Approval Rules"}
        </Button>
      </Section>

      {/* ── Approval Model ─────────────────────────────────────────────────── */}
      <Section
        title="Approval Model"
        description="Assistant model used for borderline claim review and approval reasoning"
        icon={Brain}
      >
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-[0.08em] text-white/35">
            Model
          </Label>
          <Select value={approvalModel} onValueChange={setApprovalModel}>
            <SelectTrigger className={`${adminInputClass} h-9 text-sm`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPROVAL_MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-sm">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className={`text-[11px] ${adminSectionCopyClass}`}>
            Used for reasoning steps in the adjudication pipeline — separate from the dual-agent primary model
          </p>
        </div>

        <Button onClick={saveModel} disabled={modelLoading} size="sm" className={adminActionButtonClass}>
          <Save className="h-3.5 w-3.5" />
          {modelLoading ? "Saving…" : "Save Approval Model"}
        </Button>
      </Section>

      {/* ── Tax / GST Rate ─────────────────────────────────────────────────── */}
      <Section
        title="Tax / GST Rate Override"
        description="Tax rate applied during settlement calculation"
        icon={Percent}
      >
        <div className="space-y-2">
          <VatRow market="India (Goods & Service Tax)" flag="/flags/in.svg" value={gstIndia} onChange={setGstIndia} />
        </div>

        <p className={`text-[11px] ${adminSectionCopyClass}`}>
          This rate overrides the environment default. Applied only to non-exempt services during settlement.
        </p>

        <Button onClick={saveVatRates} disabled={vatLoading} size="sm" className={adminActionButtonClass}>
          <Save className="h-3.5 w-3.5" />
          {vatLoading ? "Saving…" : "Save Tax Rate"}
        </Button>

        {/* ── GST-Exempt Service Categories ──────────────────────────────── */}
        <div className="pt-1 border-t space-y-2.5">
          <div className="flex items-center gap-1.5">
            <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" />
            <p className="text-[11px] font-semibold text-foreground uppercase tracking-[0.08em]">
              GST-Exempt Service Categories
            </p>
          </div>
          <p className={`text-[11px] leading-relaxed ${adminSectionCopyClass}`}>
            The following service categories are <strong className="text-foreground">zero-rated</strong>
            for curative medical services. GST is never added
            to these categories during settlement regardless of the rate above.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { label: "CONSULTATION", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
              { label: "DIAGNOSTIC",   color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" },
              { label: "LAB",          color: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" },
              { label: "SURGERY",      color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
              { label: "ICU",          color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
              { label: "INPATIENT",    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
              { label: "EMERGENCY",    color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
              { label: "MATERNITY",    color: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20" },
              { label: "ROOM_RENT",    color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" },
              { label: "PROCEDURE",    color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
              { label: "PHARMACY",     color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
            ].map(({ label, color }) => (
              <span
                key={label}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold font-mono ${color}`}
              >
                <BadgeCheck className="h-2.5 w-2.5 shrink-0" />
                {label}
              </span>
            ))}
          </div>
          <p className={`text-[10px] ${adminSectionCopyClass}`}>
            PROCEDURE &amp; PHARMACY are zero-rated: medical procedures and prescription
            medicines are exempt from GST.
          </p>
        </div>
      </Section>

    </div>
  );
}
