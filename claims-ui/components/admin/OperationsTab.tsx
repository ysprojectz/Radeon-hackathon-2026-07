"use client";
import { PipelineFlow }  from "@/components/dashboard/PipelineFlow";
import { FraudPrevented } from "@/components/dashboard/FraudPrevented";
import { SLAGauge }       from "@/components/dashboard/SLAGauge";
import { ServiceHealth }  from "@/components/dashboard/ServiceHealth";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import type { DashboardKPIs } from "@/lib/types";

export function OperationsTab({ initialData }: { initialData?: DashboardKPIs | null }) {
  const { kpis, isLoading } = useDashboardKPIs({ initialData: initialData ?? undefined });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.25em] text-white/30 mb-1">
          Live Pipeline
        </p>
        <p className="text-xs text-white/40 mb-4">
          Real-time claim processing stages, fraud prevention metrics, SLA compliance and service health.
        </p>
      </div>

      {/* Pipeline Flow */}
      <PipelineFlow stages={kpis?.pipeline_stages} kpis={kpis} isLoading={isLoading} />

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <FraudPrevented
          fraudToday={kpis?.fraud_prevented_today}
          fraudTotal={kpis?.total_fraud_prevented}
          isLoading={isLoading}
        />
        <SLAGauge
          complianceRate={kpis?.sla_compliance_rate}
          targetMs={kpis?.sla_target_ms}
          avgMs={kpis?.avg_processing_ms ?? kpis?.avg_processing_time_ms}
          isLoading={isLoading}
        />
        <ServiceHealth />
      </div>
    </div>
  );
}
