"use client";

import { useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";
import {
  Activity,
  Building2,
  ClipboardList,
  FileText,
  Landmark,
  Library,
  Network,
  Settings2,
  Shield,
  Workflow,
} from "lucide-react";
import { AdminConfigurationWorkspace } from "@/components/admin/AdminConfigurationWorkspace";
import AuditLogsPanel from "@/components/admin/AuditLogsPanel";
import PolicyLibraryPanel from "@/components/admin/PolicyLibraryPanel";
import GatewayConfigPanel from "@/components/admin/GatewayConfigPanel";
import HMSIntegrationsPanel from "@/components/admin/HMSIntegrationsPanel";
import ProcessFlowPanel from "@/components/admin/ProcessFlowPanel";
import AdminReportsPanel from "@/components/admin/AdminReportsPanel";
import SalesDashboardPanel from "@/components/admin/SalesDashboardPanel";
import AdminSupportPanel from "@/components/admin/AdminSupportPanel";
import type { DashboardKPIs } from "@/lib/types";
import { cn } from "@/lib/utils";

type AdminTab = "settings" | "policies" | "audit" | "integrations" | "operations";
type IntegrationTab = "gateway" | "hms" | "flows";
type OperationTab = "sales" | "support" | "reports";

const ADMIN_TABS: Array<{ id: AdminTab; label: string; icon: ElementType }> = [
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "policies", label: "Policies", icon: Library },
  { id: "audit", label: "Audit", icon: Shield },
  { id: "integrations", label: "Integrations", icon: Network },
  { id: "operations", label: "Operations", icon: Activity },
];

const INTEGRATION_TABS: Array<{ id: IntegrationTab; label: string; icon: ElementType }> = [
  { id: "gateway", label: "Gateway", icon: Landmark },
  { id: "hms", label: "HMS", icon: Building2 },
  { id: "flows", label: "Flows", icon: Workflow },
];

const OPERATION_TABS: Array<{ id: OperationTab; label: string; icon: ElementType }> = [
  { id: "sales", label: "Sales", icon: ClipboardList },
  { id: "support", label: "Support", icon: Activity },
  { id: "reports", label: "Reports", icon: FileText },
];

function readHash() {
  if (typeof window === "undefined") {
    return { tab: "settings" as AdminTab, integration: "gateway" as IntegrationTab, operation: "sales" as OperationTab };
  }

  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "policies" || hash === "audit" || hash === "operations" || hash === "integrations" || hash === "settings") {
    return { tab: hash as AdminTab, integration: "gateway" as IntegrationTab, operation: "sales" as OperationTab };
  }
  if (hash === "gateway" || hash === "integrations-gateway") {
    return { tab: "integrations" as AdminTab, integration: "gateway" as IntegrationTab, operation: "sales" as OperationTab };
  }
  if (hash === "hms" || hash === "integrations-hms") {
    return { tab: "integrations" as AdminTab, integration: "hms" as IntegrationTab, operation: "sales" as OperationTab };
  }
  if (hash === "flows" || hash === "integrations-flows") {
    return { tab: "integrations" as AdminTab, integration: "flows" as IntegrationTab, operation: "sales" as OperationTab };
  }
  if (hash === "sales" || hash === "operations-sales") {
    return { tab: "operations" as AdminTab, integration: "gateway" as IntegrationTab, operation: "sales" as OperationTab };
  }
  if (hash === "support" || hash === "operations-support" || hash === "service-health") {
    return { tab: "operations" as AdminTab, integration: "gateway" as IntegrationTab, operation: "support" as OperationTab };
  }
  if (hash === "reports" || hash === "operations-reports") {
    return { tab: "operations" as AdminTab, integration: "gateway" as IntegrationTab, operation: "reports" as OperationTab };
  }

  return { tab: "settings" as AdminTab, integration: "gateway" as IntegrationTab, operation: "sales" as OperationTab };
}

function setHash(hash: string) {
  if (typeof window === "undefined") return;
  window.history.replaceState(null, "", `${window.location.pathname}#${hash}`);
}

function SegmentedNav<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<{ id: T; label: string; icon: ElementType }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="acos-tab-rail custom-scrollbar flex gap-1.5 overflow-x-auto p-1.5">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl border px-3 text-[11px] font-black uppercase tracking-[0.14em] transition-all",
            value === id
              ? "border-brand-primary/22 bg-brand-primary/10 text-white shadow-[0_0_0_1px_rgba(0,216,214,0.1)_inset]"
              : "border-transparent bg-transparent text-white/54 hover:border-white/[0.08] hover:bg-white/[0.045] hover:text-white/82",
          )}
          aria-pressed={value === id}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function AdminCanonicalWorkspace({ initialKPIs }: { initialKPIs?: DashboardKPIs | null }) {
  const initial = useMemo(readHash, []);
  const [tab, setTab] = useState<AdminTab>(initial.tab);
  const [integrationTab, setIntegrationTab] = useState<IntegrationTab>(initial.integration);
  const [operationTab, setOperationTab] = useState<OperationTab>(initial.operation);

  useEffect(() => {
    function handleHashChange() {
      const next = readHash();
      setTab(next.tab);
      setIntegrationTab(next.integration);
      setOperationTab(next.operation);
    }

    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  function selectTab(next: AdminTab) {
    setTab(next);
    setHash(next);
  }

  function selectIntegration(next: IntegrationTab) {
    setTab("integrations");
    setIntegrationTab(next);
    setHash(`integrations-${next}`);
  }

  function selectOperation(next: OperationTab) {
    setTab("operations");
    setOperationTab(next);
    setHash(`operations-${next}`);
  }

  return (
    <div className="space-y-4">
      <SegmentedNav items={ADMIN_TABS} value={tab} onChange={selectTab} />

      {tab === "settings" && <AdminConfigurationWorkspace initialKPIs={initialKPIs} />}
      {tab === "policies" && <PolicyLibraryPanel />}
      {tab === "audit" && <AuditLogsPanel />}
      {tab === "integrations" && (
        <div className="space-y-4">
          <SegmentedNav items={INTEGRATION_TABS} value={integrationTab} onChange={selectIntegration} />
          {integrationTab === "gateway" && <GatewayConfigPanel />}
          {integrationTab === "hms" && <HMSIntegrationsPanel />}
          {integrationTab === "flows" && <ProcessFlowPanel />}
        </div>
      )}
      {tab === "operations" && (
        <div className="space-y-4">
          <SegmentedNav items={OPERATION_TABS} value={operationTab} onChange={selectOperation} />
          {operationTab === "sales" && <SalesDashboardPanel />}
          {operationTab === "support" && <AdminSupportPanel />}
          {operationTab === "reports" && <AdminReportsPanel />}
        </div>
      )}
    </div>
  );
}
