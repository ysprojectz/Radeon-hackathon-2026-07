"use client";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/Stat";
import { ClaimStatusBadge } from "@/components/claims/ClaimStatusBadge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/utils";
import type { ClaimResponse } from "@/lib/types";

interface Props {
  claims?: ClaimResponse[];
  isLoading: boolean;
}

export function ActivityFeed({ claims, isLoading }: Props) {
  const router = useRouter();
  const items = claims ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Stat key={i} tone="custom" bare className="flex h-[52px] w-full items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3">
            <Skeleton className="h-2 w-2 shrink-0 rounded-full dark:bg-white/10 bg-slate-200" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 w-24 rounded-md dark:bg-white/10 bg-slate-200" />
              <Skeleton className="h-2 w-32 rounded-md dark:bg-white/10 bg-slate-200" />
            </div>
            <div className="space-y-1.5 text-right">
              <Skeleton className="ml-auto h-5 w-14 rounded-md dark:bg-white/10 bg-slate-200" />
              <Skeleton className="ml-auto h-2 w-12 rounded-md dark:bg-white/10 bg-slate-200" />
            </div>
          </Stat>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-center">
        <p className="text-sm text-slate-400 dark:text-slate-500">No activity yet</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {items.map((claim) => {
        const statusColor =
          claim.status === "SETTLED" || claim.status === "HITL_APPROVED"
            ? "bg-emerald-500"
            : claim.status === "DENIED" || claim.status === "HITL_DENIED"
            ? "bg-red-500"
            : claim.status === "HITL_PENDING"
            ? "bg-amber-500"
            : "bg-cyan-500";

        const formattedDate = formatDate(claim.service_date);

        return (
          <Tooltip key={claim.claim_reference}>
            <TooltipTrigger asChild>
              <Stat
                as="button"
                bare
                type="button"
                className="flex h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 text-left transition-all hover:border-white/[0.1] hover:bg-white/[0.045]"
                onClick={() => router.push(`/claims/${claim.claim_reference}`)}
                aria-label={`Open claim ${claim.claim_reference} for ${claim.patient_name ?? "member"}`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusColor}`} />
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-white/85 transition-colors hover:text-cyan-300">
                      {claim.claim_reference}
                    </span>
                    <p className="mt-0.5 truncate text-[11px] text-white/50">
                      {claim.patient_name}
                    </p>
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 flex-col items-end justify-center gap-1">
                  <ClaimStatusBadge
                    status={claim.status}
                    className="bg-transparent px-2 py-0.5 text-[10px] tracking-normal"
                  />
                  <p className="flex items-center gap-1 whitespace-nowrap text-[9px] text-white/40">
                    <Clock className="h-2.5 w-2.5" />
                    {formattedDate}
                  </p>
                </div>
              </Stat>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8} className="max-w-52 rounded-xl border border-white/[0.08] bg-[#0f1117] px-3 py-2 text-[10px] text-white shadow-2xl">
              <div className="space-y-1">
                <p className="font-black text-white">{claim.claim_reference}</p>
                <p className="text-white/70">{claim.patient_name}</p>
                <p className="text-white/45">Status: {claim.status}</p>
                <p className="text-white/45">Service Date: {formattedDate}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
