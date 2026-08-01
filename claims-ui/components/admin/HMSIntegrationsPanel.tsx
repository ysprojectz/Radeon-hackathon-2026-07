"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Network, Plus, Trash2, Zap, ToggleLeft, ToggleRight,
  Loader2, CheckCircle2, XCircle, Copy,
  ChevronDown, ChevronUp, Globe, Key, Activity, RefreshCw,
} from "lucide-react";
import { fetchCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  adminListHMSSources, adminCreateHMSSource, adminUpdateHMSSource,
  adminDeleteHMSSource, adminTestHMSSource,
} from "@/lib/api";
import type { HMSSource, HMSSourceCreate } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const MARKETS = ["UAE", "KSA", "INDIA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"];

const EMPTY_FORM: HMSSourceCreate = {
  name: "", market_region: "UAE", pull_base_url: "",
  claim_pull_path: "/api/v1/claims/{claim_id}",
  pull_auth_header: "", webhook_secret: "", enabled: true,
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

interface TestResult {
  reachable: boolean; status_code: number | null;
  latency_ms: number; detail: string;
}

interface SourceCardProps {
  source: HMSSource;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onDelete: (id: string, name: string) => Promise<void>;
  onTest: (id: string) => Promise<TestResult>;
  busy: boolean;
}

function SourceCard({ source, onToggle, onDelete, onTest, busy }: SourceCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const webhookUrl = typeof window !== "undefined"
    ? `${window.location.origin}/api/v1/proxy/webhooks/hms/${source.id}`
    : `/api/v1/proxy/webhooks/hms/${source.id}`;

  async function handleTest() {
    setTesting(true); setTestResult(null);
    try { const res = await onTest(source.id); setTestResult(res); }
    finally { setTesting(false); }
  }
  async function handleToggle() {
    setToggling(true);
    try { await onToggle(source.id, !source.enabled); }
    finally { setToggling(false); }
  }
  async function handleDelete() {
    if (!confirm(`Remove "${source.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try { await onDelete(source.id, source.name); }
    finally { setDeleting(false); }
  }

  return (
    <div className={cn(
      "glass-card rounded-xl transition-all",
      source.enabled ? "shadow-md" : "shadow-sm opacity-70",
    )}>
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", source.enabled ? "bg-emerald-500" : "dark:bg-slate-600 bg-slate-300")} />
          <div className="min-w-0">
            <p className="text-sm font-semibold dark:text-white text-slate-900 truncate">{source.name}</p>
            <p className="text-xs dark:text-slate-500 text-slate-500 truncate">{source.pull_base_url}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className="hidden sm:inline text-xs font-semibold dark:border-white/10 border-slate-200 border rounded-md px-2 py-0.5 dark:text-slate-300 text-slate-600">
            {source.market_region}
          </span>
          <span className="hidden md:flex items-center gap-1 text-xs dark:text-slate-500 text-slate-500">
            <Activity className="h-3 w-3" />{source.total_events}
          </span>
          <button onClick={handleToggle} disabled={toggling || busy} title={source.enabled ? "Click to disable" : "Click to enable"}
            className="transition-opacity hover:opacity-70 disabled:opacity-40">
            {toggling ? <Loader2 className="h-5 w-5 animate-spin dark:text-slate-500 text-slate-400" />
              : source.enabled ? <ToggleRight className="h-5 w-5 text-emerald-500" />
              : <ToggleLeft className="h-5 w-5 dark:text-slate-600 text-slate-300" />}
          </button>
          <button onClick={() => setExpanded(e => !e)} className="dark:text-slate-400 text-slate-400 dark:hover:text-slate-200 hover:text-slate-600 transition-colors"
            aria-label={expanded ? "Collapse details" : "Expand details"}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="dark:border-white/5 border-slate-200 border-t p-4 space-y-4">
          <div>
            <p className="text-xs font-semibold dark:text-slate-400 text-slate-500 mb-1">Webhook URL (copy to HMS)</p>
            <div className="flex items-center gap-2 dark:border-white/10 border-slate-200 border rounded-lg dark:bg-white/[0.02] bg-slate-50 px-3 py-2">
              <Globe className="h-3.5 w-3.5 dark:text-slate-500 text-slate-400 shrink-0" />
              <code className="font-mono text-xs dark:text-slate-300 text-slate-700 flex-1 truncate">{webhookUrl}</code>
              <button onClick={() => copyToClipboard(webhookUrl)} title="Copy webhook URL"
                className="dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-cyan-600 transition-colors">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold dark:text-slate-400 text-slate-500 mb-1">Source ID</p>
              <div className="flex items-center gap-2 dark:border-white/10 border-slate-200 border rounded-lg dark:bg-white/[0.02] bg-slate-50 px-3 py-2">
                <code className="font-mono text-xs dark:text-slate-300 text-slate-600 flex-1 truncate">{source.id}</code>
                <button onClick={() => copyToClipboard(source.id)} title="Copy ID"
                  className="dark:text-slate-500 text-slate-400 dark:hover:text-cyan-400 hover:text-cyan-600 transition-colors">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold dark:text-slate-400 text-slate-500 mb-1">Claim Pull Path</p>
              <div className="dark:border-white/10 border-slate-200 border rounded-lg dark:bg-white/[0.02] bg-slate-50 px-3 py-2">
                <code className="font-mono text-xs dark:text-slate-300 text-slate-600">{source.claim_pull_path}</code>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Key className="h-3.5 w-3.5 dark:text-slate-500 text-slate-400" />
            <span className="dark:text-slate-500 text-slate-500">Webhook secret:</span>
            {source.webhook_secret
              ? <span className="font-semibold dark:text-white text-slate-900">{source.webhook_secret}</span>
              : <span className="text-amber-500">Not set &mdash; production webhooks are rejected until a secret is configured</span>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs dark:text-slate-500 text-slate-500">
            <div><span className="font-semibold">Registered:</span> {formatDate(source.registered_at)}</div>
            <div><span className="font-semibold">Last event:</span> {formatDate(source.last_event_at)}</div>
          </div>
          {testResult && (
            <div className={cn(
              "flex items-center gap-2 border rounded-lg px-3 py-2 text-sm",
              testResult.reachable
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                : "border-red-500/20 bg-red-500/10 text-red-400",
            )}>
              {testResult.reachable ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
              <span>
                {testResult.reachable ? "Reachable" : "Unreachable"} &mdash; {testResult.detail}
                {testResult.latency_ms > 0 && ` (${testResult.latency_ms}ms)`}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="text-xs h-8">
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Zap className="h-3.5 w-3.5 mr-1.5" />}
              Test Connectivity
            </Button>
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={deleting}
              className="text-xs h-8 dark:border-red-500/20 border-red-300 text-red-500 dark:hover:border-red-400 hover:bg-red-500/10 ml-auto">
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
              Remove Source
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function HMSIntegrationsPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [sources, setSources] = useState<HMSSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<HMSSourceCreate>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchCurrentUser().then((u) => {
      if (!u || u.role !== "ADMIN") router.replace("/");
      else setChecking(false);
    }).catch(() => router.replace("/"));
  }, [router]);

  const loadSources = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try { setSources(await adminListHMSSources()); }
    catch (err) { setLoadError(err instanceof Error ? err.message : "Failed to load sources"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (!checking) loadSources(); }, [checking, loadSources]);

  async function handleToggle(id: string, enabled: boolean) {
    await adminUpdateHMSSource(id, { enabled });
    setSources(prev => prev.map(s => (s.id === id ? { ...s, enabled } : s)));
  }
  async function handleDelete(id: string) {
    await adminDeleteHMSSource(id);
    setSources(prev => prev.filter(s => s.id !== id));
  }
  async function handleTest(id: string) { return adminTestHMSSource(id); }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setSaveError("Name is required"); return; }
    if (!form.pull_base_url.trim()) { setSaveError("Pull Base URL is required"); return; }
    setSaving(true); setSaveError(null);
    try {
      const created = await adminCreateHMSSource(form);
      setSources(prev => [...prev, created]);
      setForm(EMPTY_FORM); setShowForm(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to create source");
    } finally { setSaving(false); }
  }

  if (checking || (loading && sources.length === 0)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin dark:text-slate-500 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="HMS Integrations"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={loadSources} disabled={loading} className="h-8 text-xs dark:border-white/20 dark:text-slate-300 dark:hover:text-white">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => { setShowForm(s => !s); setSaveError(null); }} className="h-8 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Source
            </Button>
          </div>
        }
      />

      {/* How it works banner */}
      <div className="glass-card rounded-xl p-4">
        <p className="text-xs dark:text-slate-400 text-slate-600 leading-relaxed">
          <span className="font-semibold dark:text-white text-slate-900">How it works:</span>{" "}
          The HMS sends a{" "}
          <code className="dark:bg-white/5 bg-slate-100 dark:border-white/10 border-slate-200 border rounded px-1 text-cyan-500">POST /api/v1/webhooks/hms/&#123;source_id&#125;</code>{" "}
          event when a new claim is ready. ACOS verifies the HMAC signature, immediately returns{" "}
          <code className="dark:bg-white/5 bg-slate-100 dark:border-white/10 border-slate-200 border rounded px-1 text-cyan-500">200 OK</code>, then fetches the claim data
          from the HMS pull URL in the background and runs it through the adjudication pipeline. No polling required.
        </p>
      </div>

      {/* Add source form */}
      {showForm && (
        <div className="glass-card rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold dark:text-white text-slate-900">Register New HMS Source</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Display Name <span className="text-red-500">*</span></Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Apollo Chennai HMS" className="h-9 glass-input" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Market Region</Label>
                <Select value={form.market_region} onValueChange={v => setForm(f => ({ ...f, market_region: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{MARKETS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Pull Base URL <span className="text-red-500">*</span></Label>
                <Input value={form.pull_base_url} onChange={e => setForm(f => ({ ...f, pull_base_url: e.target.value }))} placeholder="https://hms.hospital.com" className="h-9 glass-input" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Claim Pull Path</Label>
                <Input value={form.claim_pull_path} onChange={e => setForm(f => ({ ...f, claim_pull_path: e.target.value }))} placeholder="/api/v1/claims/{claim_id}" className="h-9 glass-input" />
                <p className="text-xs dark:text-slate-500 text-slate-500">Use <code>&#123;claim_id&#125;</code> as placeholder</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Pull Auth Header</Label>
                <Input value={form.pull_auth_header} onChange={e => setForm(f => ({ ...f, pull_auth_header: e.target.value }))} placeholder="Bearer eyJhbGci..." type="password" className="h-9 glass-input" />
                <p className="text-xs dark:text-slate-500 text-slate-500">Authorization header sent when pulling claim data</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Webhook Secret (HMAC)</Label>
                <Input value={form.webhook_secret} onChange={e => setForm(f => ({ ...f, webhook_secret: e.target.value }))} placeholder="leave blank to skip HMAC verification" type="password" className="h-9 glass-input" />
                <p className="text-xs dark:text-slate-500 text-slate-500">Verifies X-Hub-Signature-256 header on inbound webhooks</p>
              </div>
            </div>
            {saveError && (
              <div className="flex items-center gap-2 border-red-500/20 border rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
                <XCircle className="h-4 w-4 shrink-0" />{saveError}
              </div>
            )}
            <div className="flex items-center gap-3 pt-1">
              <Button type="submit" disabled={saving} className="text-xs font-semibold h-9 bg-cyan-600 hover:bg-cyan-500">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                Register Source
              </Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setSaveError(null); }} className="text-xs h-9">
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      {loadError && (
        <div className="flex items-center gap-2 border-red-500/20 border rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <XCircle className="h-4 w-4 shrink-0" />{loadError}
        </div>
      )}

      {/* Sources list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs dark:text-slate-400 text-slate-600 font-semibold">
            {sources.length === 0 ? "No sources registered"
              : `${sources.length} source${sources.length !== 1 ? "s" : ""} \u2014 ${sources.filter(s => s.enabled).length} enabled`}
          </p>
          {sources.length > 0 && (
            <p className="text-xs dark:text-slate-500 text-slate-500">
              Total events: <span className="font-semibold dark:text-white text-slate-900">{sources.reduce((acc, s) => acc + (s.total_events ?? 0), 0)}</span>
            </p>
          )}
        </div>

        {sources.map(src => (
          <SourceCard key={src.id} source={src} onToggle={handleToggle} onDelete={handleDelete} onTest={handleTest} busy={loading} />
        ))}

        {!loading && sources.length === 0 && (
          <div className="glass-card rounded-xl p-10 text-center border-dashed">
            <Network className="h-10 w-10 dark:text-slate-600 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-semibold dark:text-slate-400 text-slate-600">No HMS sources registered</p>
            <p className="text-xs dark:text-slate-500 text-slate-500 mt-1">
              Click &quot;Add Source&quot; to register your first Hospital Management System
            </p>
          </div>
        )}
      </div>

      {/* Integration guide */}
      <div className="glass-card rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold dark:text-slate-400 text-slate-600">HMS Integration Guide</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { step: "01", title: "Register Source", body: "Add your HMS pull URL, auth credentials, and optional HMAC secret above." },
            { step: "02", title: "Configure HMS", body: "Set the webhook URL from this page in your HMS system to POST on new claims." },
            { step: "03", title: "Claims Flow In", body: "Events arrive, ACOS pulls & adjudicates in background. Zero manual steps." },
          ].map(({ step, title, body }) => (
            <div key={step} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold dark:text-cyan-400 text-cyan-600">{step}</span>
                <span className="text-sm font-semibold dark:text-white text-slate-900">{title}</span>
              </div>
              <p className="text-xs dark:text-slate-400 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
        <div>
          <p className="text-xs font-semibold dark:text-slate-400 text-slate-600 mb-2">Minimum Webhook Payload</p>
          <pre className="dark:bg-[#0f1014] bg-slate-900 dark:border-white/5 border-slate-700 border rounded-lg p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
{`POST /api/v1/webhooks/hms/{source_id}
X-Hub-Signature-256: sha256=<hmac-sha256-hex>
Content-Type: application/json

{ "claim_id": "CLM-2024-001234" }`}
          </pre>
        </div>
      </div>
    </div>
  );
}
