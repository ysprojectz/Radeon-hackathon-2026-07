"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { adminUpdateConfig } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  adminActionButtonClass,
  adminInputClass,
  adminPanelClass,
  adminSectionTitleClass,
} from "@/components/admin/admin-theme";

// ── Numeric field row ─────────────────────────────────────────────────────────

interface FieldRowProps {
  label: string;
  tooltip: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  isFloat?: boolean;
}

function FieldRow({ label, tooltip, value, onChange, unit, min, max, step = 1, isFloat }: FieldRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.04] bg-white/[0.02] px-5 py-3.5 transition-colors hover:bg-white/[0.03]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Label className="text-[13px] font-bold leading-none text-white/90">{label}</Label>
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 shrink-0 cursor-help text-white/30 hover:text-brand-primary transition-colors" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[280px] text-xs font-medium leading-relaxed bg-[#1a1a24] border-white/10 text-white/90 p-3 shadow-xl">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Input
          type="number"
          min={min}
          max={max}
          step={isFloat ? (step ?? 0.1) : step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${adminInputClass} h-9 w-28 text-sm font-mono font-medium text-right tabular-nums focus:ring-brand-primary`}
        />
        {unit && (
          <span className="w-8 text-[11px] font-bold uppercase text-white/40">{unit}</span>
        )}
      </div>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

interface SectionCardProps {
  title: string;
  badge: string;
  children: React.ReactNode;
}

function SectionCard({ title, badge, children }: SectionCardProps) {
  return (
    <div className={cn(adminPanelClass, "overflow-hidden shadow-sm")}>
      <div className="flex items-center justify-between border-b border-white/[0.04] bg-white/[0.01] px-5 py-4">
        <p className={cn(adminSectionTitleClass, "text-[15px]")}>{title}</p>
        <span className="rounded-full border border-[var(--status-info)]/20 bg-[var(--status-info)]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--status-info)]">
          {badge}
        </span>
      </div>
      <div className="space-y-4 px-5 py-5 bg-black/10">
        {children}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { config: SystemConfig | undefined; onSaved: () => void; }

export function RulesEngineTab({ config, onSaved }: Props) {
  // India fields
  const [roomRentCap,        setRoomRentCap]        = useState("1.0");
  const [ayushMinDays,       setAyushMinDays]       = useState("1");
  const [domiciliaryMinDays, setDomiciliaryMinDays] = useState("3");

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (config) {
      setRoomRentCap(String(config.re_india_room_rent_limit_pct       ?? 1.0));
      setAyushMinDays(String(config.re_india_ayush_min_days           ?? 1));
      setDomiciliaryMinDays(String(config.re_india_domiciliary_min_days ?? 3));
    }
  }, [config]);

  async function save() {
    setLoading(true);
    try {
      const values = {
        re_india_room_rent_limit_pct:     parseFloat(roomRentCap),
        re_india_ayush_min_days:          parseInt(ayushMinDays),
        re_india_domiciliary_min_days:    parseInt(domiciliaryMinDays),
      };

      // Guard 1: catch empty / non-numeric fields before sending to API
      if (Object.values(values).some(Number.isNaN)) {
        toast.error("All fields must have valid numeric values");
        setLoading(false);
        return;
      }

      // Guard 2: range validation — report first failing rule
      const rangeErrors: string[] = [];
      if (values.re_india_room_rent_limit_pct    < 0 || values.re_india_room_rent_limit_pct    > 10)  rangeErrors.push("Room Rent Cap must be 0–10%");
      if (values.re_india_ayush_min_days         < 1)                                                  rangeErrors.push("AYUSH Min Days must be at least 1");
      if (values.re_india_domiciliary_min_days   < 1)                                                  rangeErrors.push("Domiciliary Min Days must be at least 1");

      if (rangeErrors.length > 0) {
        toast.error(rangeErrors[0]);
        setLoading(false);
        return;
      }

      await adminUpdateConfig(values);
      toast.success("Rules Engine config saved", {
        description: "Changes take effect on the next claim adjudication",
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">

      {/* Header */}
      <div className={cn(adminPanelClass, "p-6 shadow-sm")}>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 flex items-center gap-2">
          <Info className="h-4 w-4 text-brand-primary" /> Standard Rules Configuration
        </p>
        <p className="mt-2.5 max-w-4xl text-[14px] leading-relaxed text-white/60">
          Set the basic limits and rules for processing claims. These standard checks happen on every claim before the AI reviews it.
        </p>
      </div>

      {/* Info banner */}
      <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.08] px-5 py-4 text-[13px] font-medium leading-relaxed text-cyan-100 shadow-sm">
        <span className="font-bold">Policy benefit values take priority.</span>{" "}
        These settings act as system-level fallbacks when a specific policy doesn&apos;t
        define a value. Changes take effect immediately on the next adjudication call — no restart required.
      </div>

      {/* ── India Market ───────────────────────────────────────────────────── */}
      <SectionCard title="India Market Rules" badge="IRDAI · GIPSA">
        <FieldRow
          label="Room Rent Cap"
          tooltip="Maximum room rent as a percentage of sum insured per day. Standard IRDAI guideline: 1% of SI/day."
          value={roomRentCap}
          onChange={setRoomRentCap}
          unit="% /day" min={0} max={10} step={0.1} isFloat
        />

        <div className="my-1 border-t border-border/40" />

        <FieldRow
          label="AYUSH Min Hospitalization"
          tooltip="Minimum number of inpatient/daycare days required for AYUSH (Ayurveda, Yoga, Naturopathy, etc.) claims to qualify for coverage."
          value={ayushMinDays}
          onChange={setAyushMinDays}
          unit="days" min={1} max={30}
        />
        <FieldRow
          label="Domiciliary Min Duration"
          tooltip="Minimum consecutive treatment days required for domiciliary hospitalization claims (Section 12). Standard: 3 days."
          value={domiciliaryMinDays}
          onChange={setDomiciliaryMinDays}
          unit="days" min={1} max={30}
        />
      </SectionCard>

      <div className="pt-2">
        <Button onClick={save} disabled={loading} size="sm" className={cn(adminActionButtonClass, "h-10 px-6 font-bold text-xs")}>
          <Save className="mr-2 h-4 w-4" />
          {loading ? "Saving Configuration…" : "Save Rules Engine Config"}
        </Button>
      </div>
    </div>
  );
}
