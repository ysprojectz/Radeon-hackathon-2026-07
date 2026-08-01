"use client";

import {
  Activity,
  Brain,
  CheckCircle,
  MessageSquareMore,
  Gauge,
  KeyRound,
  Scale,
  Server,
  Settings2,
  UsersRound,
  Users,
  Workflow,
  BarChart2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMyScreenAccess } from "@/lib/api";
import { useAdminConfig } from "@/lib/hooks/useAdminConfig";
import { UsersTab } from "@/components/admin/UsersTab";
import { UserGroupsTab } from "@/components/admin/UserGroupsTab";
import { AuthConfigTab } from "@/components/admin/AuthConfigTab";
import { AIConfigTab } from "@/components/admin/AIConfigTab";
import { RateLimitsTab } from "@/components/admin/RateLimitsTab";
import { SystemTab } from "@/components/admin/SystemTab";
import { HealthStatusTab } from "@/components/admin/HealthStatusTab";
import { RulesEngineTab } from "@/components/admin/RulesEngineTab";
import { ClaimApprovalTab } from "@/components/admin/ClaimApprovalTab";
import { ComplianceTab } from "@/components/admin/ComplianceTab";
import { WorkflowOpsTab } from "@/components/admin/WorkflowOpsTab";
import { OperationsTab } from "@/components/admin/OperationsTab";
import { ChatBotTab } from "@/components/admin/ChatBotTab";
import type { DashboardKPIs } from "@/lib/types";

const TABS = [
  { value: "users", label: "Users", icon: Users, hint: "Access", screenId: "admin-settings" },
  { value: "groups", label: "Groups", icon: UsersRound, hint: "Active Sets", screenId: "admin-settings" },
  { value: "auth", label: "Auth", icon: KeyRound, hint: "Identity", screenId: "admin-settings" },
  { value: "ai", label: "Assistant Review", icon: Brain, hint: "Models", screenId: "admin-settings" },
  { value: "chatbot", label: "Bot Character", icon: MessageSquareMore, hint: "Avatar", screenId: "admin-settings" },
  { value: "rules", label: "Rules Engine", icon: Settings2, hint: "Policy", screenId: "admin-policies" },
  { value: "compliance", label: "Compliance", icon: Scale, hint: "Regulatory", screenId: "admin-audit" },
  { value: "workflows", label: "Workflows", icon: Workflow, hint: "System Tasks", screenId: "admin-operations" },
  { value: "limits", label: "Rate Limits", icon: Gauge, hint: "Protection", screenId: "admin-settings" },
  { value: "system", label: "System", icon: Server, hint: "Runtime", screenId: "admin-settings" },
  { value: "approval", label: "Claim Approval", icon: CheckCircle, hint: "Approvals", screenId: "admin-policies" },
  { value: "health", label: "Health", icon: Activity, hint: "Status", screenId: "admin-operations" },
  { value: "operations", label: "Operations", icon: BarChart2, hint: "Journey", screenId: "admin-operations" },
] as const;

export function AdminConfigurationWorkspace({ initialKPIs }: { initialKPIs?: DashboardKPIs | null }) {
  const { config, refresh: refetchConfig } = useAdminConfig();
  const [allowedScreenIds, setAllowedScreenIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    function refreshAccess() {
      getMyScreenAccess()
        .then((access) => setAllowedScreenIds(new Set(access.allowed_screen_ids)))
        .catch(() => setAllowedScreenIds(null));
    }

    refreshAccess();
    window.addEventListener("acos-screen-access-updated", refreshAccess);
    return () => window.removeEventListener("acos-screen-access-updated", refreshAccess);
  }, []);

  const visibleTabs = useMemo(() => {
    if (!allowedScreenIds) return TABS;
    const filtered = TABS.filter((tab) => allowedScreenIds.has(tab.screenId));
    return filtered.length > 0 ? filtered : TABS.filter((tab) => tab.screenId === "admin-settings");
  }, [allowedScreenIds]);

  const defaultTab = visibleTabs[0]?.value ?? "users";

  return (
    <div className="dashboard-panel overflow-hidden rounded-[2rem]">
      <div className="dashboard-panel-accent bg-gradient-to-r from-cyan-300/0 via-cyan-300/36 to-fuchsia-300/0" />
      <div className="dashboard-panel-glow -top-10 right-10 bg-cyan-300/16" />

      <Tabs key={defaultTab} defaultValue={defaultTab} className="space-y-0">
        <div className="relative border-b border-white/6 px-3 py-3 sm:px-4">
          <div className="pointer-events-none absolute inset-y-3 left-3 z-10 w-5 bg-gradient-to-r from-[#07080b] to-transparent" />
          <div className="pointer-events-none absolute inset-y-3 right-3 z-10 w-5 bg-gradient-to-l from-[#07080b] to-transparent" />
          <TabsList className="custom-scrollbar !flex !h-auto w-full justify-start gap-1.5 overflow-x-auto overflow-y-auto max-h-[120px] flex-wrap rounded-[1.35rem] border border-white/8 bg-white/[0.025] p-1.5">
            {visibleTabs.map(({ value, label, hint, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="group !h-10 shrink-0 rounded-2xl border border-transparent bg-transparent px-3 text-left transition-all data-[state=active]:border-brand-primary/22 data-[state=active]:bg-brand-primary/10 data-[state=active]:text-white data-[state=active]:shadow-[0_0_0_1px_rgba(0,216,214,0.1)_inset] hover:border-white/[0.08] hover:bg-white/[0.045]"
              >
                <div className="flex h-full items-center gap-2.5">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.035] text-white/42 transition-colors group-data-[state=active]:border-brand-primary/18 group-data-[state=active]:bg-brand-primary/14 group-data-[state=active]:text-brand-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="grid min-w-0 leading-none">
                    <span className="whitespace-nowrap text-[11px] font-black tracking-tight text-white/76 group-data-[state=active]:text-white">
                      {label}
                    </span>
                    <span className="mt-0.5 whitespace-nowrap text-[7px] font-black uppercase tracking-[0.16em] text-white/24 group-data-[state=active]:text-white/42">
                      {hint}
                    </span>
                  </div>
                </div>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.012),transparent_26%)] px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
          {visibleTabs.some((tab) => tab.value === "users") && (
            <TabsContent value="users" className="mt-0">
              <UsersTab />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "groups") && (
            <TabsContent value="groups" className="mt-0">
              <UserGroupsTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "auth") && (
            <TabsContent value="auth" className="mt-0">
              <AuthConfigTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "ai") && (
            <TabsContent value="ai" className="mt-0">
              <AIConfigTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "chatbot") && (
            <TabsContent value="chatbot" className="mt-0">
              <ChatBotTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "rules") && (
            <TabsContent value="rules" className="mt-0">
              <RulesEngineTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "compliance") && (
            <TabsContent value="compliance" className="mt-0">
              <ComplianceTab />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "workflows") && (
            <TabsContent value="workflows" className="mt-0">
              <WorkflowOpsTab />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "limits") && (
            <TabsContent value="limits" className="mt-0">
              <RateLimitsTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "system") && (
            <TabsContent value="system" className="mt-0">
              <SystemTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "approval") && (
            <TabsContent value="approval" className="mt-0">
              <ClaimApprovalTab config={config} onSaved={refetchConfig} />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "health") && (
            <TabsContent value="health" className="mt-0">
              <HealthStatusTab />
            </TabsContent>
          )}
          {visibleTabs.some((tab) => tab.value === "operations") && (
            <TabsContent value="operations" className="mt-0">
              <OperationsTab initialData={initialKPIs} />
            </TabsContent>
          )}
        </div>
      </Tabs>
    </div>
  );
}
