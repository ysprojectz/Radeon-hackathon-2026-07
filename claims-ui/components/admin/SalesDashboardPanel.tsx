"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Users, DollarSign, Percent, FileCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

interface SalesAgent {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  license_number: string | null;
  agency_name: string | null;
  market_region: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface PolicySale {
  id: string;
  policy_id: string;
  policy_number: string | null;
  agent_id: string | null;
  member_id: string | null;
  member_name: string | null;
  sale_date: string;
  effective_date: string;
  channel: string;
  premium_amount: number;
  commission_amount: number;
  commission_pct: number;
  status: string;
  binder_number: string | null;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

// No per-record currency field exists in the sales API response yet — single
// point of control here rather than hardcoding the symbol at each call site.
const CURRENCY = "₹";

interface Quote {
  id: string;
  quote_reference: string;
  member_id: string | null;
  policy_id: string | null;
  premium_quoted: number;
  effective_date_proposed: string | null;
  expiry_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface Commission {
  id: string;
  policy_sale_id: string;
  agent_id: string;
  amount: number;
  currency: string;
  status: string;
  paid_at: string | null;
  payment_reference: string | null;
  tenant_id: string;
  created_at: string;
  updated_at: string;
}

interface SalesSummary {
  total_policies_sold: number;
  total_premium: number;
  total_commission: number;
  average_commission_pct: number;
  by_channel: Record<string, { count: number; premium: number; commission: number }>;
  by_status: Record<string, { count: number; premium: number }>;
  by_region: Record<string, { count: number; premium: number }>;
  policies_this_month: number;
  premium_this_month: number;
}

interface AgentPerformance {
  agent_id: string;
  agent_name: string;
  total_sales: number;
  total_premium: number;
  total_commission: number;
  average_commission_pct: number;
  policies_this_month: number;
}

export default function SalesDashboardPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [agents, setAgents] = useState<SalesAgent[]>([]);
  const [sales, setSales] = useState<PolicySale[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [agentPerformance, setAgentPerformance] = useState<AgentPerformance[]>([]);

  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const apiGet = useCallback(async <T,>(path: string): Promise<T | null> => {
    const proxyPath = `/api/v1/proxy${path.replace(/^\/api\/v1/, "")}`;
    const res = await fetch(proxyPath, { credentials: "include" });
    if (!res.ok) {
      if (res.status === 401) router.replace(`/login?next=${encodeURIComponent("/admin/sales")}`);
      return null;
    }
    return res.json() as Promise<T>;
  }, [router]);

  const fetchSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      if (channelFilter) params.set("channel", channelFilter);
      const data = await apiGet<SalesSummary>(`/api/v1/admin/sales/summary?${params.toString()}`);
      if (data) setSummary(data);
    } catch (e) { void e; }
  }, [apiGet, channelFilter, dateRange.end, dateRange.start]);

  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiGet<SalesAgent[]>("/api/v1/sales/agents");
      if (data) setAgents(data);
    } catch (e) { void e; }
  }, [apiGet]);

  const fetchSales = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      if (channelFilter) params.set("channel", channelFilter);
      if (statusFilter) params.set("status", statusFilter);
      const data = await apiGet<PolicySale[]>(`/api/v1/sales/policies?${params.toString()}`);
      if (data) setSales(data);
    } catch (e) { void e; }
  }, [apiGet, channelFilter, dateRange.end, dateRange.start, statusFilter]);

  const fetchQuotes = useCallback(async () => {
    try {
      const data = await apiGet<Quote[]>("/api/v1/sales/quotes");
      if (data) setQuotes(data);
    } catch (e) { void e; }
  }, [apiGet]);

  const fetchCommissions = useCallback(async () => {
    try {
      const data = await apiGet<Commission[]>("/api/v1/sales/commissions?status=PENDING");
      if (data) setCommissions(data);
    } catch (e) { void e; }
  }, [apiGet]);

  const fetchAgentPerformance = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (dateRange.start) params.set("start_date", dateRange.start);
      if (dateRange.end) params.set("end_date", dateRange.end);
      const data = await apiGet<AgentPerformance[]>(`/api/v1/admin/sales/agent-performance?${params.toString()}`);
      if (data) setAgentPerformance(data);
    } catch (e) { void e; }
  }, [apiGet, dateRange.end, dateRange.start]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchSummary(),
        fetchAgents(),
        fetchSales(),
        fetchQuotes(),
        fetchCommissions(),
        fetchAgentPerformance(),
      ]);
    } finally {
      setLoading(false);
    }
  }, [fetchAgentPerformance, fetchAgents, fetchCommissions, fetchQuotes, fetchSales, fetchSummary]);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  // Re-fetch when filters change (only after auth check completes)
  useEffect(() => {
    if (!checking) {
      void fetchAllData();
    }
  }, [checking, fetchAllData]);

  const channelColors: Record<string, string> = {
    DIRECT: "#10b981", BROKER: "#3b82f6", TPA: "#8b5cf6",
    ONLINE: "#f59e0b", REFERRAL: "#ec4899", WALK_IN: "#ef4444",
  };
  const statusColors: Record<string, string> = {
    BOUND: "#10b981", QUOTED: "#3b82f6", CANCELLED: "#ef4444",
    LAPSED: "#f59e0b", EXPIRED: "#6b7280",
  };

  const cardClass = "glass-card border border-white/10";
  const statValueClass = "text-3xl font-bold";
  const statLabelClass = "text-sm text-white/60 mt-1";

  if (checking) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Sales Intelligence Dashboard" />

      <Card className={cardClass + " p-4"}>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-white/60 mb-1 block">Date Range</label>
            <div className="flex gap-2">
              <Input type="date" value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="bg-black/40 border-white/10 text-sm h-8" />
              <Input type="date" value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="bg-black/40 border-white/10 text-sm h-8" />
            </div>
          </div>
          <div>
            <label className="text-xs text-white/60 mb-1 block">Channel</label>
            <Select value={channelFilter || "__ALL__"} onValueChange={(value) => setChannelFilter(value === "__ALL__" ? "" : value)}>
              <SelectTrigger className="w-32 bg-black/40 border-white/10 text-sm h-8">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All</SelectItem>
                {Object.keys(channelColors).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-white/60 mb-1 block">Status</label>
            <Select value={statusFilter || "__ALL__"} onValueChange={(value) => setStatusFilter(value === "__ALL__" ? "" : value)}>
              <SelectTrigger className="w-32 bg-black/40 border-white/10 text-sm h-8">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__ALL__">All</SelectItem>
                {Object.keys(statusColors).map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchAllData} className="h-8">Refresh</Button>
        </div>
      </Card>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className={cardClass + " p-4"}>
              <Skeleton className="h-8 w-24 mb-2" /><Skeleton className="h-6 w-16" />
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className={cardClass + " p-4"}>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-cyan-500/10 rounded-lg"><FileCheck className="w-5 h-5 text-cyan-400" /></div>
              <span className="text-cyan-400 text-sm">Total Policies</span>
            </div>
            <div className={statValueClass}>{summary.total_policies_sold.toLocaleString()}</div>
            <div className={statLabelClass}>{summary.policies_this_month} this month</div>
          </Card>
          <Card className={cardClass + " p-4"}>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-lg"><DollarSign className="w-5 h-5 text-emerald-400" /></div>
              <span className="text-emerald-400 text-sm">Total Premium</span>
            </div>
            <div className={statValueClass}>{CURRENCY} {summary.total_premium.toLocaleString()}</div>
            <div className={statLabelClass}>{CURRENCY} {summary.premium_this_month.toLocaleString()} this month</div>
          </Card>
          <Card className={cardClass + " p-4"}>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-amber-500/10 rounded-lg"><Percent className="w-5 h-5 text-amber-400" /></div>
              <span className="text-amber-400 text-sm">Total Commission</span>
            </div>
            <div className={statValueClass}>{CURRENCY} {summary.total_commission.toLocaleString()}</div>
            <div className={statLabelClass}>Avg {summary.average_commission_pct.toFixed(1)}%</div>
          </Card>
          <Card className={cardClass + " p-4"}>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-violet-500/10 rounded-lg"><Users className="w-5 h-5 text-violet-400" /></div>
              <span className="text-violet-400 text-sm">Active Agents</span>
            </div>
            <div className={statValueClass}>{agents.filter(a => a.is_active).length}</div>
            <div className={statLabelClass}>{agents.length} total</div>
          </Card>
        </div>
      ) : null}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="glass-card border border-white/10">
          <TabsTrigger value="overview" className="data-[state=active]:bg-cyan-500/20">Overview</TabsTrigger>
          <TabsTrigger value="sales" className="data-[state=active]:bg-cyan-500/20">Policy Sales</TabsTrigger>
          <TabsTrigger value="quotes" className="data-[state=active]:bg-cyan-500/20">Quotes</TabsTrigger>
          <TabsTrigger value="agents" className="data-[state=active]:bg-cyan-500/20">Agents</TabsTrigger>
          <TabsTrigger value="commissions" className="data-[state=active]:bg-cyan-500/20">Commissions</TabsTrigger>
          <TabsTrigger value="performance" className="data-[state=active]:bg-cyan-500/20">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {loading ? (
            <div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
          ) : summary ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className={cardClass + " p-4"}>
                <h3 className="text-sm font-medium text-white/80 mb-4">Sales by Channel</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(summary.by_channel).map(([ch, d]) => ({ channel: ch, count: d.count }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="channel" stroke="rgba(255,255,255,0.5)" />
                      <YAxis stroke="rgba(255,255,255,0.5)" />
                      <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid #333" }} />
                      <Bar dataKey="count" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className={cardClass + " p-4"}>
                <h3 className="text-sm font-medium text-white/80 mb-4">Sales by Status</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={Object.entries(summary.by_status).map(([st, d]) => ({ name: st, value: d.count }))}
                        cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                        {Object.entries(summary.by_status).map(([st]) => <Cell key={st} fill={statusColors[st] || "#6b7280"} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid #333" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card className={cardClass + " p-4"}>
                <h3 className="text-sm font-medium text-white/80 mb-4">Sales by Region</h3>
                <div className="space-y-2">
                  {Object.entries(summary.by_region).map(([r, d]) => (
                    <div key={r} className="flex justify-between items-center py-2 border-b border-white/5">
                      <span className="text-white/80">{r}</span>
                      <div className="text-right"><div className="font-medium">{d.count} policies</div>
                        <div className="text-sm text-white/50">{CURRENCY} {d.premium.toLocaleString()}</div></div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="sales">
          <Card className={cardClass + " p-4"}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow className="border-white/10">
                  <TableHead className="text-white/80">Policy #</TableHead><TableHead className="text-white/80">Agent</TableHead>
                  <TableHead className="text-white/80">Member</TableHead><TableHead className="text-white/80">Channel</TableHead>
                  <TableHead className="text-white/80 text-right">Premium</TableHead><TableHead className="text-white/80 text-right">Commission</TableHead>
                  <TableHead className="text-white/80">Status</TableHead><TableHead className="text-white/80">Date</TableHead>
                </TableRow></TableHeader>
                <TableBody>{loading ? [...Array(5)].map((_, i) => (
                  <TableRow key={i} className="border-white/5"><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell></TableRow>)) : sales.map((s) => (
                  <TableRow key={s.id} className="border-white/5 hover:bg-white/5">
                    <TableCell className="font-mono text-sm">{s.policy_number || "—"}</TableCell>
                    <TableCell className="text-sm">{s.agent_id ? (agents.find((a) => a.id === s.agent_id)?.full_name ?? s.agent_id.slice(0, 8)) : "—"}</TableCell>
                    <TableCell className="text-sm">{s.member_name || "—"}</TableCell>
                    <TableCell><Badge style={{ backgroundColor: channelColors[s.channel] + "20", color: channelColors[s.channel] }}>{s.channel}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{CURRENCY} {s.premium_amount.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">{CURRENCY} {s.commission_amount.toLocaleString()}</TableCell>
                    <TableCell><Badge style={{ backgroundColor: statusColors[s.status] + "20", color: statusColors[s.status] }}>{s.status}</Badge></TableCell>
                    <TableCell className="text-sm">{format(new Date(s.sale_date), "MMM d, yyyy")}</TableCell>
                  </TableRow>))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="quotes">
          <Card className={cardClass + " p-4"}>
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow className="border-white/10">
                <TableHead className="text-white/80">Quote Ref</TableHead><TableHead className="text-white/80">Policy</TableHead>
                <TableHead className="text-white/80">Premium</TableHead><TableHead className="text-white/80">Status</TableHead>
                <TableHead className="text-white/80">Effective Date</TableHead><TableHead className="text-white/80">Expiry</TableHead>
              </TableRow></TableHeader><TableBody>{loading ? [...Array(3)].map((_, i) => (
                <TableRow key={i} className="border-white/5"><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell></TableRow>)) : quotes.map((q) => (
                <TableRow key={q.id} className="border-white/5 hover:bg-white/5">
                  <TableCell className="font-mono text-sm">{q.quote_reference}</TableCell>
                  <TableCell className="text-sm">{q.policy_id?.slice(0,8) || "—"}</TableCell>
                  <TableCell className="font-medium">{CURRENCY} {q.premium_quoted.toLocaleString()}</TableCell>
                  <TableCell><Badge style={{ backgroundColor: statusColors[q.status] + "20", color: statusColors[q.status] }}>{q.status}</Badge></TableCell>
                  <TableCell className="text-sm">{q.effective_date_proposed ? format(new Date(q.effective_date_proposed), "MMM d, yyyy") : "—"}</TableCell>
                  <TableCell className="text-sm">{q.expiry_date ? format(new Date(q.expiry_date), "MMM d, yyyy") : "—"}</TableCell>
                </TableRow>))}
              </TableBody></Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="agents">
          <Card className={cardClass + " p-4"}>
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow className="border-white/10">
                <TableHead className="text-white/80">Agent</TableHead><TableHead className="text-white/80">Email</TableHead>
                <TableHead className="text-white/80">License</TableHead><TableHead className="text-white/80">Agency</TableHead>
                <TableHead className="text-white/80">Region</TableHead><TableHead className="text-white/80">Status</TableHead>
              </TableRow></TableHeader><TableBody>{loading ? [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-white/5"><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell><TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell><TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell></TableRow>)) : agents.map((a) => (
                <TableRow key={a.id} className="border-white/5 hover:bg-white/5">
                  <TableCell className="font-medium">{a.full_name}</TableCell>
                  <TableCell className="text-sm">{a.email}</TableCell>
                  <TableCell className="text-sm">{a.license_number || "—"}</TableCell>
                  <TableCell className="text-sm">{a.agency_name || "—"}</TableCell>
                  <TableCell className="text-sm">{a.market_region}</TableCell>
                  <TableCell><Badge style={{ backgroundColor: a.is_active ? "#10b98120" : "#6b728020", color: a.is_active ? "#10b981" : "#6b7280" }}>{a.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                </TableRow>))}
              </TableBody></Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="commissions">
          <Card className={cardClass + " p-4"}>
            <div className="overflow-x-auto">
              <Table><TableHeader><TableRow className="border-white/10">
                <TableHead className="text-white/80">Commission ID</TableHead><TableHead className="text-white/80">Sale ID</TableHead>
                <TableHead className="text-white/80">Agent</TableHead><TableHead className="text-white/80 text-right">Amount</TableHead>
                <TableHead className="text-white/80">Status</TableHead><TableHead className="text-white/80">Paid Date</TableHead>
              </TableRow></TableHeader><TableBody>{loading ? [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-white/5"><TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell><TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell><TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell></TableRow>)) : commissions.map((c) => (
                <TableRow key={c.id} className="border-white/5 hover:bg-white/5">
                  <TableCell className="font-mono text-sm">{c.id.slice(0,8)}</TableCell>
                  <TableCell className="font-mono text-xs">{c.policy_sale_id.slice(0,8)}</TableCell>
                  <TableCell className="text-sm">{agents.find((a) => a.id === c.agent_id)?.full_name ?? c.agent_id.slice(0, 8)}</TableCell>
                  <TableCell className="text-right font-medium">{c.currency} {c.amount.toLocaleString()}</TableCell>
                  <TableCell><Badge style={{ backgroundColor: c.status === "PAID" ? "#10b98120" : c.status === "ADJUSTED" ? "#f59e0b20" : "#f43f5e20", color: c.status === "PAID" ? "#10b981" : c.status === "ADJUSTED" ? "#f59e0b" : "#f43f5e" }}>{c.status}</Badge></TableCell>
                  <TableCell className="text-sm">{c.paid_at ? format(new Date(c.paid_at), "MMM d, yyyy") : "—"}</TableCell>
                </TableRow>))}
              </TableBody></Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="performance">
          {loading ? (
            <Card className={cardClass + " p-4"}><Skeleton className="h-96 w-full" /></Card>
          ) : (
            <div className="space-y-4">
              <Card className={cardClass + " p-4"}>
                <h3 className="text-sm font-medium text-white/80 mb-4">Agent Leaderboard</h3>
                <div className="overflow-x-auto">
                  <Table><TableHeader><TableRow className="border-white/10">
                    <TableHead className="text-white/80">Rank</TableHead><TableHead className="text-white/80">Agent</TableHead>
                    <TableHead className="text-white/80 text-right">Sales</TableHead><TableHead className="text-white/80 text-right">Premium</TableHead>
                    <TableHead className="text-white/80 text-right">Commission</TableHead><TableHead className="text-white/80 text-right">Avg %</TableHead>
                    <TableHead className="text-white/80 text-right">This Month</TableHead>
                  </TableRow></TableHeader><TableBody>
                    {agentPerformance.map((p, idx) => (
                      <TableRow key={p.agent_id} className="border-white/5 hover:bg-white/5">
                        <TableCell className="font-bold">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{p.agent_name}</TableCell>
                        <TableCell className="text-right font-medium">{p.total_sales}</TableCell>
                        <TableCell className="text-right font-medium">{CURRENCY} {p.total_premium.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-medium text-amber-400">{CURRENCY} {p.total_commission.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{p.average_commission_pct.toFixed(1)}%</TableCell>
                        <TableCell className="text-right text-cyan-400 font-medium">{p.policies_this_month}</TableCell>
                      </TableRow>))}
                  </TableBody></Table>
                </div>
              </Card>
              <Card className={cardClass + " p-4"}>
                <h3 className="text-sm font-medium text-white/80 mb-4">Top Agents - Commission</h3>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={agentPerformance.slice(0,5).map((a) => ({ name: a.agent_name.split(" ")[0], commission: a.total_commission }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                      <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
                      <YAxis stroke="rgba(255,255,255,0.5)" />
                      <Tooltip contentStyle={{ backgroundColor: "#111", border: "1px solid #333" }} labelStyle={{ color: "#fff" }}
                        formatter={(v) => [`${CURRENCY} ${(v as number).toLocaleString()}`, "Commission"]} />
                      <Bar dataKey="commission" fill="#10b981" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
