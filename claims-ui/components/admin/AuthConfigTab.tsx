"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

export function AuthConfigTab({ config, onSaved }: Props) {
  const [accessTtl,   setAccessTtl]   = useState(15);
  const [refreshTtl,  setRefreshTtl]  = useState(7);
  const [swagger,     setSwagger]     = useState(false);
  const [demo,        setDemo]        = useState(false);
  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    if (config) {
      setAccessTtl(config.access_token_ttl_minutes);
      setRefreshTtl(config.refresh_token_ttl_days);
      setSwagger(config.enable_swagger_ui);
      setDemo(config.enable_demo_endpoints);
    }
  }, [config]);

  async function save() {
    setLoading(true);
    try {
      await adminUpdateConfig({
        access_token_ttl_minutes: accessTtl,
        refresh_token_ttl_days:   refreshTtl,
        enable_swagger_ui:        swagger,
        enable_demo_endpoints:    demo,
      });
      toast.success("Auth settings saved", { description: "Takes effect on next token issue" });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className={adminPanelClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Identity Controls</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/46">
          Tune token lifetime, developer exposure, and demo access without leaving the control plane.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className={`${adminSubPanelClass} flex h-full flex-col gap-2.5`}>
          <Label htmlFor="access-ttl" className="block text-sm font-semibold normal-case tracking-normal leading-5 text-white">
            Access Token TTL <span className="font-normal text-white/35">(minutes)</span>
          </Label>
          <Input id="access-ttl" type="number" min={1} max={1440}
            className={adminInputClass}
            value={accessTtl} onChange={(e) => setAccessTtl(Number(e.target.value))} />
          <p className={adminSectionCopyClass}>How long a login session token stays valid</p>
        </div>
        <div className={`${adminSubPanelClass} flex h-full flex-col gap-2.5`}>
          <Label htmlFor="refresh-ttl" className="block text-sm font-semibold normal-case tracking-normal leading-5 text-white">
            Refresh Token TTL <span className="font-normal text-white/35">(days)</span>
          </Label>
          <Input id="refresh-ttl" type="number" min={1} max={90}
            className={adminInputClass}
            value={refreshTtl} onChange={(e) => setRefreshTtl(Number(e.target.value))} />
          <p className={adminSectionCopyClass}>How long before user must re-login</p>
        </div>
      </div>

      <div className={`${adminPanelClass} space-y-3`}>
        <div className="flex flex-col gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 pr-2">
            <p className={adminSectionTitleClass}>Swagger UI</p>
            <p className={adminSectionCopyClass}>Enable `/docs` service explorer in controlled environments</p>
          </div>
          <Switch checked={swagger} onCheckedChange={setSwagger} className="self-start sm:self-center" />
        </div>
        <div className="flex flex-col gap-3 rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 pr-2">
            <p className={adminSectionTitleClass}>Demo Endpoints</p>
            <p className={adminSectionCopyClass}>Expose sample workflow endpoints for internal validation only</p>
          </div>
          <Switch checked={demo} onCheckedChange={setDemo} className="self-start sm:self-center" />
        </div>
      </div>

      <Button onClick={save} disabled={loading} size="sm" className={adminActionButtonClass}>
        <Save className="h-3.5 w-3.5" />
        {loading ? "Saving…" : "Save Auth Settings"}
      </Button>
    </div>
  );
}
