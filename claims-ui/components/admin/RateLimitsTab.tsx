"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminUpdateConfig } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";
import {
  adminActionButtonClass,
  adminInputClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
  adminSubPanelClass,
} from "@/components/admin/admin-theme";

interface Props { config: SystemConfig | undefined; onSaved: () => void; }

function RateLimitField({
  id, label, description, value, onChange,
}: {
  id: string; label: string; description: string;
  value: string; onChange: (v: string) => void;
}) {
  const [count, period] = value.split("/");
  return (
    <div className="flex items-center justify-between gap-4 rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-300" />
          <p className={adminSectionTitleClass}>{label}</p>
        </div>
        <p className={`mt-0.5 ${adminSectionCopyClass}`}>{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input
          id={id}
          type="number"
          min={1}
          max={10000}
          value={count ?? ""}
          onChange={(e) => onChange(`${e.target.value}/${period ?? "minute"}`)}
          className={`${adminInputClass} w-20 text-right`}
        />
        <span className="text-sm text-white/35">/ minute</span>
      </div>
    </div>
  );
}

export function RateLimitsTab({ config, onSaved }: Props) {
  const [adjudication, setAdjudication] = useState("30/minute");
  const [standard,     setStandard]     = useState("120/minute");
  const [health,       setHealth]       = useState("300/minute");
  const [loading,      setLoading]      = useState(false);

  useEffect(() => {
    if (config) {
      setAdjudication(config.rate_limit_adjudication ?? "30/minute");
      setStandard(config.rate_limit_standard ?? "120/minute");
      setHealth(config.rate_limit_health ?? "300/minute");
    }
  }, [config]);

  async function save() {
    setLoading(true);
    try {
      await adminUpdateConfig({
        rate_limit_adjudication: adjudication,
        rate_limit_standard:     standard,
        rate_limit_health:       health,
      });
      toast.success("Rate limits saved", {
        description: "Restart required to apply changes",
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
      <div className={adminPanelClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Traffic Protection</p>
        <p className="mt-2 text-sm leading-6 text-white/45">
        Maximum requests allowed per minute per IP address.
        </p>
      </div>

      <div className={`${adminSubPanelClass} space-y-3`}>
        <RateLimitField
          id="rl-adj" label="AI Adjudication" value={adjudication} onChange={setAdjudication}
          description="POST /claims, POST /claims/upload — AI processing endpoints"
        />
        <RateLimitField
          id="rl-std" label="Standard Service" value={standard} onChange={setStandard}
          description="GET claims, review queue, policies, members"
        />
        <RateLimitField
          id="rl-health" label="Health Check" value={health} onChange={setHealth}
          description="GET /health — uptime monitoring probes"
        />
      </div>

      <div className="rounded-[1.15rem] border border-amber-300/18 bg-amber-300/8 px-4 py-3">
        <p className="text-xs text-amber-100/88">
          Changes are stored in `config.json`. A service restart is required before new rate limits take effect.
        </p>
      </div>

      <Button onClick={save} disabled={loading} size="sm" className={adminActionButtonClass}>
        <Save className="h-3.5 w-3.5" />
        {loading ? "Saving…" : "Save Rate Limits"}
      </Button>
    </div>
  );
}
