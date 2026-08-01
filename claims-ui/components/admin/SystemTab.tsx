"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, Plus, X, Info, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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

const CHAT_ROLES = ["ADMIN", "ADJUSTER", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR", "COMPLIANCE_OFFICER"];
const SETTINGS_MARKETS = [
  { key: "UAE", currency: "AED" },
  { key: "INDIA", currency: "INR" },
  { key: "KSA", currency: "SAR" },
];

export function SystemTab({ config, onSaved }: Props) {
  const [redisUrl,    setRedisUrl]    = useState("redis://redis:6379/0");
  const [dbEnabled,   setDbEnabled]   = useState(true);
  const [corsOrigins, setCorsOrigins] = useState<string[]>([]);
  const [newOrigin,   setNewOrigin]   = useState("");

  // Confidence threshold state
  const [lowConf,     setLowConf]     = useState(80);
  const [medConf,     setMedConf]     = useState(95);
  const [medValue,    setMedValue]    = useState(50000);
  const [highValue,   setHighValue]   = useState(100000);
  const [weightT1,    setWeightT1]    = useState(0.40);
  const [weightT2,    setWeightT2]    = useState(0.60);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [chatRoles, setChatRoles] = useState<string[]>(CHAT_ROLES);
  const [chatMarkets, setChatMarkets] = useState<string[]>(SETTINGS_MARKETS.map((m) => m.key));
  const [slaSettings, setSlaSettings] = useState<Record<string, { enabled: boolean; hours: number }>>({});

  const [loading,     setLoading]     = useState(false);

  useEffect(() => {
    if (config) {
      setRedisUrl(config.redis_url ?? "redis://redis:6379/0");
      setDbEnabled(config.enable_db_persistence ?? true);
      setCorsOrigins(config.cors_allowed_origins ?? []);
      setLowConf(config.hitl_low_confidence_threshold    ?? 80);
      setMedConf(config.hitl_medium_confidence_threshold ?? 95);
      setMedValue(config.hitl_medium_value_threshold     ?? 50000);
      setHighValue(config.hitl_high_value_threshold      ?? 100000);
      setWeightT1(config.confidence_weight_t1            ?? 0.40);
      setWeightT2(config.confidence_weight_t2            ?? 0.60);
      setChatEnabled(config.chat_assistant_enabled ?? true);
      setChatRoles(config.chat_assistant_roles ?? CHAT_ROLES);
      setChatMarkets(config.chat_assistant_markets ?? SETTINGS_MARKETS.map((m) => m.key));
      setSlaSettings(config.sla_settings_by_market ?? {
        UAE: { enabled: true, hours: 8 },
        INDIA: { enabled: true, hours: 12 },
        KSA: { enabled: true, hours: 8 },
      });
    }
  }, [config]);

  function addOrigin() {
    const val = newOrigin.trim();
    if (!val || corsOrigins.includes(val)) return;
    setCorsOrigins([...corsOrigins, val]);
    setNewOrigin("");
  }

  function removeOrigin(o: string) {
    setCorsOrigins(corsOrigins.filter((x) => x !== o));
  }

  function handleWeightT1Change(val: number) {
    const clamped = Math.min(Math.max(val, 0), 1);
    setWeightT1(clamped);
    setWeightT2(parseFloat((1 - clamped).toFixed(2)));
  }

  function handleWeightT2Change(val: number) {
    const clamped = Math.min(Math.max(val, 0), 1);
    setWeightT2(clamped);
    setWeightT1(parseFloat((1 - clamped).toFixed(2)));
  }

  async function save() {
    if (weightT1 + weightT2 !== 1.0 && Math.abs(weightT1 + weightT2 - 1.0) > 0.01) {
      toast.error("T1 + T2 weights must sum to 1.0");
      return;
    }
    if (lowConf >= medConf) {
      toast.error("Low confidence threshold must be less than medium threshold");
      return;
    }
    if (medValue >= highValue) {
      toast.error("Medium value threshold must be less than high value threshold");
      return;
    }
    setLoading(true);
    try {
      await adminUpdateConfig({
        redis_url:             redisUrl,
        enable_db_persistence: dbEnabled,
        cors_allowed_origins:  corsOrigins,
        hitl_low_confidence_threshold:    lowConf,
        hitl_medium_confidence_threshold: medConf,
        hitl_medium_value_threshold:      medValue,
        hitl_high_value_threshold:        highValue,
        confidence_weight_t1:             weightT1,
        confidence_weight_t2:             weightT2,
        chat_assistant_enabled:           chatEnabled,
        chat_assistant_roles:             chatRoles,
        chat_assistant_markets:           chatMarkets,
        sla_settings_by_market:           slaSettings,
      });
      toast.success("System settings saved", {
        description: "Confidence thresholds apply immediately. CORS/Redis require restart.",
      });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className={adminPanelClass}>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/30">Runtime Policy</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-white/46">
          Control adjudication confidence routing, persistence, Redis behavior, and trusted origins from one operational panel.
        </p>
      </div>

      {/* ── Adjudication Confidence Thresholds ── */}
      <section className={`${adminPanelClass} space-y-4`}>
        <div>
          <h3 className={adminSectionTitleClass}>Adjudication Confidence Thresholds</h3>
        </div>

        <div className="divide-y divide-white/8 rounded-[1.15rem] border border-white/8 bg-black/20 text-sm">
          {/* Low confidence */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
            <div>
              <p className={adminSectionTitleClass}>Low Confidence Threshold</p>
              <p className={adminSectionCopyClass}>
                Score below this -&gt; <Badge variant="destructive" className="text-[10px] py-0">Manual review</Badge> (24 h due time)
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number" min={0} max={100}
                value={lowConf}
                onChange={(e) => setLowConf(Number(e.target.value))}
                className={`${adminInputClass} w-20 text-right font-mono text-sm`}
              />
              <span className="text-xs text-white/35">/ 100</span>
            </div>
          </div>

          {/* Medium confidence */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
            <div>
              <p className={adminSectionTitleClass}>Medium Confidence Threshold</p>
              <p className={adminSectionCopyClass}>
                Score below this + billed &gt; medium value -&gt; <Badge variant="outline" className="text-[10px] py-0">Manual review</Badge> (48 h due time)
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number" min={0} max={100}
                value={medConf}
                onChange={(e) => setMedConf(Number(e.target.value))}
                className={`${adminInputClass} w-20 text-right font-mono text-sm`}
              />
              <span className="text-xs text-white/35">/ 100</span>
            </div>
          </div>

          {/* Medium value */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
            <div>
              <p className={adminSectionTitleClass}>Medium Value Threshold</p>
              <p className={adminSectionCopyClass}>Billed amount trigger for medium confidence check</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number" min={0}
                value={medValue}
                onChange={(e) => setMedValue(Number(e.target.value))}
                className={`${adminInputClass} w-28 text-right font-mono text-sm`}
              />
            </div>
          </div>

          {/* High value */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-4 px-4 py-3">
            <div>
              <p className={adminSectionTitleClass}>High Value Threshold</p>
              <p className={adminSectionCopyClass}>Claims above this always route to manual review (48 h due time)</p>
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                type="number" min={0}
                value={highValue}
                onChange={(e) => setHighValue(Number(e.target.value))}
                className={`${adminInputClass} w-28 text-right font-mono text-sm`}
              />
            </div>
          </div>
        </div>

        {/* Two-tier weights */}
        <div className={`${adminSubPanelClass} space-y-3`}>
          <Label className={`flex items-center gap-1.5 ${adminSectionTitleClass}`}>
            Two-Tier Confidence Weights
            <Info className="h-3.5 w-3.5 text-white/35" />
          </Label>
          <p className={adminSectionCopyClass}>
            T1 = Regional/Regulatory · T2 = Company Policy · Must sum to 1.0
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="w-t1" className="text-xs text-white/35">T1 Weight (Regulatory)</Label>
              <Input id="w-t1" type="number" min={0} max={1} step={0.01}
                value={weightT1}
                onChange={(e) => handleWeightT1Change(Number(e.target.value))}
                className={`${adminInputClass} font-mono text-sm`} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="w-t2" className="text-xs text-white/35">T2 Weight (Company)</Label>
              <Input id="w-t2" type="number" min={0} max={1} step={0.01}
                value={weightT2}
                onChange={(e) => handleWeightT2Change(Number(e.target.value))}
                className={`${adminInputClass} font-mono text-sm`} />
            </div>
          </div>
          <div className={`rounded-lg px-3 py-2 text-xs ${Math.abs(weightT1 + weightT2 - 1.0) > 0.01 ? "border border-rose-300/20 bg-rose-300/10 text-rose-200" : "border border-emerald-300/20 bg-emerald-300/10 text-emerald-200"}`}>
            Sum: {(weightT1 + weightT2).toFixed(2)} {Math.abs(weightT1 + weightT2 - 1.0) <= 0.01 ? "✓" : "— must equal 1.0"}
          </div>
        </div>
      </section>

      <section className={`${adminPanelClass} space-y-4`}>
        <div>
          <h3 className={`${adminSectionTitleClass} flex items-center gap-2`}>
            <MessageSquare className="h-4 w-4 text-cyan-200" />
            Chat Assistance
          </h3>
        </div>
        <div className="flex items-center justify-between rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
          <div>
            <p className={adminSectionTitleClass}>Enable Assistant Globally</p>
            <p className={adminSectionCopyClass}>Turns the floating assistant on or off across the portal.</p>
          </div>
          <Switch checked={chatEnabled} onCheckedChange={setChatEnabled} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className={adminSubPanelClass}>
            <p className={adminSectionTitleClass}>Allowed Roles</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CHAT_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setChatRoles((current) => current.includes(role) ? current.filter((r) => r !== role) : [...current, role])}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${chatRoles.includes(role) ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-white/8 bg-black/20 text-white/42"}`}
                >
                  {role.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
          <div className={adminSubPanelClass}>
            <p className={adminSectionTitleClass}>Allowed Markets</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SETTINGS_MARKETS.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChatMarkets((current) => current.includes(key) ? current.filter((m) => m !== key) : [...current, key])}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${chatMarkets.includes(key) ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" : "border-white/8 bg-black/20 text-white/42"}`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${adminPanelClass} space-y-4`}>
        <div>
          <h3 className={adminSectionTitleClass}>Market Due-Time Controls</h3>
        </div>
        <div className="grid gap-3">
          {SETTINGS_MARKETS.map(({ key }) => {
            const item = slaSettings[key] ?? { enabled: true, hours: 8 };
            return (
              <div key={key} className="rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={adminSectionTitleClass}>{key} due time</p>
                    <p className={adminSectionCopyClass}>{item.enabled ? `${item.hours} hour target` : "Due time disabled for this market"}</p>
                  </div>
                  <Switch
                    checked={item.enabled}
                    onCheckedChange={(enabled) => setSlaSettings((current) => ({ ...current, [key]: { ...item, enabled } }))}
                  />
                </div>
                <input
                  type="range"
                  min={4}
                  max={48}
                  step={2}
                  value={item.hours}
                  disabled={!item.enabled}
                  onChange={(event) => setSlaSettings((current) => ({ ...current, [key]: { ...item, hours: Number(event.target.value) } }))}
                  className="mt-3 w-full accent-cyan-300 disabled:opacity-35"
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Database & Redis ── */}
      <section className={`${adminPanelClass} space-y-4`}>
        <h3 className={adminSectionTitleClass}>Infrastructure</h3>

        {/* DB Persistence */}
        <div className="flex items-center justify-between rounded-[1rem] border border-white/8 bg-black/20 px-4 py-3">
          <div>
            <p className={adminSectionTitleClass}>PostgreSQL Persistence</p>
            <p className={adminSectionCopyClass}>Save claims to database. When disabled, the app runs in memory-only mode.</p>
          </div>
          <Switch checked={dbEnabled} onCheckedChange={setDbEnabled} />
        </div>

        {/* Redis URL */}
        <div className="space-y-1.5">
          <Label htmlFor="redis-url" className={adminSectionTitleClass}>Redis URL</Label>
          <Input id="redis-url" value={redisUrl}
            onChange={(e) => setRedisUrl(e.target.value)}
            placeholder="redis://redis:6379/0"
            className={`${adminInputClass} font-mono text-xs`} />
          <p className={adminSectionCopyClass}>Used for rate limiting. Falls back to in-memory if unreachable.</p>
        </div>
      </section>

      {/* ── CORS Origins ── */}
      <section className={`${adminPanelClass} space-y-3`}>
        <h3 className={adminSectionTitleClass}>CORS Allowed Origins</h3>
        <div className="flex min-h-[40px] flex-wrap gap-1.5 rounded-[1rem] border border-white/8 bg-black/20 px-3 py-2">
          {corsOrigins.map((o) => (
            <Badge key={o} variant="secondary"
              className="gap-1 border border-white/10 bg-white/[0.06] pr-1 text-xs font-normal text-white/78">
              {o}
              <button onClick={() => removeOrigin(o)}
                className="ml-0.5 hover:text-rose-500 transition-colors">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {corsOrigins.length === 0 && (
            <span className="py-0.5 text-xs text-white/35">No origins added</span>
          )}
        </div>
        <div className="flex gap-2">
          <Input value={newOrigin} onChange={(e) => setNewOrigin(e.target.value)}
            placeholder="https://your-frontend.com"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOrigin(); } }}
            className={`${adminInputClass} text-xs`} />
          <Button type="button" variant="outline" size="sm"
            onClick={addOrigin} className={adminActionButtonClass}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        <p className={adminSectionCopyClass}>Domains allowed to make service requests from browsers.</p>
      </section>

      <div className="rounded-[1.15rem] border border-amber-300/18 bg-amber-300/8 px-4 py-3">
        <p className="text-xs text-amber-100/88">
          CORS and Redis URL changes require a service restart. Confidence thresholds apply immediately.
        </p>
      </div>

      <Button onClick={save} disabled={loading} size="sm" className={adminActionButtonClass}>
        <Save className="h-3.5 w-3.5" />
        {loading ? "Saving…" : "Save System Settings"}
      </Button>
    </div>
  );
}
