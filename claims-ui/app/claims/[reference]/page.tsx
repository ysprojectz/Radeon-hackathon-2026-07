"use client";
import { use, useEffect, useState } from "react";
import {
  AlertCircle, FileText, ArrowLeft, ScanLine,
  Phone, Mail, MapPin, User, Stethoscope, Shield, Calendar,
  Building2, Hash, Download, ExternalLink, Activity,
  Calculator, History, ListChecks, ScrollText,
} from "lucide-react";
import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/shared/PageHeader";
import { ClaimHeader } from "@/components/claim-detail/ClaimHeader";
import { SettlementBreakdown } from "@/components/claim-detail/SettlementBreakdown";
import { LineItemsTable } from "@/components/claim-detail/LineItemsTable";
import { PolicyCitationsPanel } from "@/components/claim-detail/PolicyCitationsPanel";
import { AuditTimeline } from "@/components/claim-detail/AuditTimeline";
import { PipelineObservabilityPanel } from "@/components/claim-detail/PipelineObservabilityPanel";
import { CompletenessStatusPanel } from "@/components/claims/CompletenessStatusPanel";
import { MultiAgentConsensus } from "@/components/claim-detail/MultiAgentConsensus";
import { useClaimDetail } from "@/lib/hooks/useClaimDetail";
import { getClaimDocumentUrl } from "@/lib/api";
import type { ClaimResponse, OcrExtractedData, OcrExtractedField, PolicyCitation } from "@/lib/types";
import dynamic from "next/dynamic";

const PDFExportButton = dynamic(
  () => import("@/components/pdf/PDFExportButton").then((m) => ({ default: m.PDFExportButton })),
  { ssr: false, loading: () => <span className="text-xs text-white/35">Loading PDF…</span> }
);

interface Props {
  params: Promise<{ reference: string }>;
}

function normalizeValidationWarnings(claim: ClaimResponse): string[] {
  const warnings = claim.validation_warnings ?? [];
  const calculated = Number(claim.calculated_confidence);
  const safe = Number(claim.confidence_score);
  const aiSkipped = claim.completeness?.components.ai_reasoning.status === "SKIPPED";
  const cap = claim.confidence_cap;
  const capLimit = cap?.limit ?? (aiSkipped ? 80 : null);

  return warnings.map((warning) => {
    if (
      aiSkipped
      && capLimit != null
      && Number.isFinite(calculated)
      && Number.isFinite(safe)
      && calculated === safe
      && safe <= capLimit
      && /confidence capped at/i.test(warning)
    ) {
      return `Coverage review skipped — ${capLimit.toFixed(0)}% maximum applies; calculated score remains ${safe.toFixed(1)}%`;
    }
    return warning;
  });
}

export default function ClaimDetailPage({ params }: Props) {
  const { reference } = use(params);
  const { claim, settlement, audit, isLoading, error } = useClaimDetail(reference);

  if (isLoading) {
    return (
      <>
        <PageHeader title="Claim Details" />
        <LoadingSpinner message="Loading claim details…" />
      </>
    );
  }

  if (error || !claim) {
    return (
      <>
        <PageHeader title="Claim Details" />
        <div className="glass-card flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 max-w-lg">
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-400">{error?.message ?? "Claim not found."}</p>
        </div>
      </>
    );
  }

  // Merge assistant citations (settlement + claim.ai_citations), deduplicated by clause_reference.
  // If both are empty, derive citations from rules-engine line-item data.
  const llmCitations: PolicyCitation[] = [
    ...(settlement?.policy_citations ?? []),
    ...(claim.ai_citations?.map((c) => ({
      clause_id:      c.clause_reference,
      clause_reference: c.clause_reference,
      clause_text:    c.text_excerpt,
      tier:           c.tier,
      relevance_score: c.relevance_score,
    } satisfies PolicyCitation)) ?? []),
  ].filter(
    (c, i, arr) =>
      arr.findIndex((x) => (x.clause_id ?? x.clause_reference) === (c.clause_id ?? c.clause_reference)) === i
  );

  const citations: PolicyCitation[] = llmCitations.length > 0
    ? llmCitations
    : deriveRulesCitations(claim.line_items ?? []);

  const citationsFromRules = llmCitations.length === 0 && citations.length > 0;

  const documentUrl = getClaimDocumentUrl(reference);
  const hasPipelineObservability = Boolean(
    claim.pipeline_stage_report?.stages?.length ||
    claim.agent_status_metrics && Object.keys(claim.agent_status_metrics).length > 0 ||
    claim.validation_signals && Object.keys(claim.validation_signals).length > 0
  );
  const detailTabs = [
    { value: "settlement", label: "Settlement", icon: <Calculator className="h-3.5 w-3.5" /> },
    ...(hasPipelineObservability
      ? [{ value: "pipeline", label: "Journey", icon: <Activity className="h-3.5 w-3.5" /> }]
      : []),
    { value: "lineitems", label: `Line Items (${claim.line_items?.length ?? 0})`, icon: <ListChecks className="h-3.5 w-3.5" /> },
    { value: "citations", label: `Policy Citations (${citations.length})`, icon: <ScrollText className="h-3.5 w-3.5" /> },
    { value: "audit", label: `Event History${audit ? ` (${audit.total_entries})` : ""}`, icon: <History className="h-3.5 w-3.5" /> },
    ...(claim.ocr_extracted_data
      ? [{ value: "ocrdata", label: "Document Data", icon: <ScanLine className="h-3.5 w-3.5" /> }]
      : []),
    { value: "document", label: "Document", icon: <FileText className="h-3.5 w-3.5" /> },
  ];
  const validationWarnings = normalizeValidationWarnings(claim);

  return (
    <div className="acos-page">
      <PageHeader title="Claim Details" />

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/claims"
          className="flex items-center gap-1 text-white/40 hover:text-brand-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Claims
        </Link>
        <span className="text-white/20">/</span>
        <span className="font-mono font-semibold text-brand-primary">{reference}</span>
      </div>

      {/* Claim Header card */}
      <ClaimHeader
        claim={claim}
        actions={
          settlement && audit ? (
            <PDFExportButton claim={claim} settlement={settlement} audit={audit} />
          ) : undefined
        }
      />

      <div className="glass-card overflow-hidden">
        <Tabs defaultValue="settlement" className="space-y-0">
          <div className="border-b border-white/[0.07] bg-white/[0.025] px-3 py-3">
            <TabsList className="flex h-auto w-full justify-start gap-2 overflow-x-auto rounded-none bg-transparent p-0">
              {detailTabs.map(({ value, label, icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-transparent px-3.5 text-[11px] font-bold text-white/42 transition-colors hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white/72 data-[state=active]:border-brand-primary/25 data-[state=active]:bg-brand-primary/12 data-[state=active]:text-brand-primary"
              >
                {icon}{label}
              </TabsTrigger>
            ))}
            </TabsList>
          </div>

          <div className="p-4 sm:p-5 lg:p-6">
            {/* Settlement */}
            <TabsContent value="settlement" className="mt-0 focus-visible:outline-none">
              <div className="space-y-5">
                {claim.agent_agreement_score !== undefined && claim.agent_agreement_score !== null && (
                  <MultiAgentConsensus 
                    agreementScore={claim.agent_agreement_score}
                    hasConflict={claim.status === "HITL_PENDING" && claim.hitl_reason === "AGENT_CONFLICT"}
                    details={claim.agent_disagreement_items}
                  />
                )}
                {claim.completeness && (
                  <CompletenessStatusPanel
                    completeness={claim.completeness}
                    calculated_confidence={claim.calculated_confidence}
                    safe_confidence={claim.confidence_score}
                    confidence_cap={claim.confidence_cap}
                  />
                )}
                {validationWarnings.length > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 p-4">
                    <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      {validationWarnings.map((w, i) => (
                        <p key={i} className="text-sm text-amber-300/80">{w}</p>
                      ))}
                    </div>
                  </div>
                )}
                {settlement ? (
                  <SettlementBreakdown settlement={settlement} claim={claim} />
                ) : (
                  <p className="text-sm text-white/35 py-6">Settlement details not yet available.</p>
                )}
              </div>
            </TabsContent>

            {/* Line Items */}
            <TabsContent value="pipeline" className="mt-0 focus-visible:outline-none">
              <PipelineObservabilityPanel claim={claim} audit={audit ?? undefined} />
            </TabsContent>

            {/* Line Items */}
            <TabsContent value="lineitems" className="mt-0 focus-visible:outline-none">
              {(claim.line_items?.length ?? 0) > 0 ? (
                <LineItemsTable lineItems={claim.line_items ?? []} currency={claim.currency} settlement={settlement} />
              ) : (
                <p className="text-sm text-white/35 py-6">No line items found.</p>
              )}
            </TabsContent>

            {/* Citations */}
            <TabsContent value="citations" className="mt-0 focus-visible:outline-none">
              <div className="space-y-6">
                <PolicyCitationsPanel citations={citations} fromRulesEngine={citationsFromRules} />
                {settlement?.policy_documents_used && settlement.policy_documents_used.length > 0 && (
                  <PolicyDocumentsSection documents={settlement.policy_documents_used} />
                )}
              </div>
            </TabsContent>

            {/* Audit */}
            <TabsContent value="audit" className="mt-0 focus-visible:outline-none">
              {audit ? (
                <AuditTimeline audit={audit} />
              ) : (
                <p className="text-sm text-white/35 py-6">Event history not available.</p>
              )}
            </TabsContent>

            {/* Document Data */}
            <TabsContent value="ocrdata" className="mt-0 focus-visible:outline-none">
              <OcrDataPanel data={claim.ocr_extracted_data} claim={claim} />
            </TabsContent>

            {/* Document */}
            <TabsContent value="document" className="mt-0 focus-visible:outline-none">
              <DocumentViewer url={documentUrl} reference={reference} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

// ── Rules-engine citation fallback ───────────────────────────────────────────
function deriveRulesCitations(lineItems: import("@/lib/types").ClaimLineItemResponse[]): PolicyCitation[] {
  const out: PolicyCitation[] = [];
  const seen = new Set<string>();
  for (const item of lineItems) {
    if (item.clause_references?.length) {
      for (const ref of item.clause_references) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        out.push({
          clause_id:        ref,
          clause_reference: ref,
          tier:             "COMPANY",
          clause_text:      item.denial_reason ?? (item.is_covered === false ? "Coverage denied per policy rules" : "Standard coverage rules applied"),
          source:           `Rules Engine — ${item.procedure_code} (Line ${item.line_number})`,
          status:           item.is_covered === false ? "DENIED" : "COVERED",
        });
      }
    } else if (item.denial_reason) {
      const key = `${item.denial_code ?? "RULE"}-${item.line_number}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          clause_id:        item.denial_code ?? `LINE-${item.line_number}`,
          clause_reference: item.denial_code ?? `LINE-${item.line_number}`,
          tier:             "COMPANY",
          clause_text:      item.denial_reason,
          source:           `Rules Engine — ${item.procedure_code} (Line ${item.line_number})`,
          status:           "DENIED",
        });
      }
    }
  }
  return out;
}

// ── Document field helpers ────────────────────────────────────────────────────
function getFieldValue(v: OcrExtractedField | string | undefined | Record<string, unknown>): string | null {
  if (!v) return null;
  if (typeof v === "string") return v || null;
  if (typeof v === "object" && "value" in v) return (v as OcrExtractedField).value || null;
  return null;
}
function getFieldConf(v: OcrExtractedField | string | undefined | Record<string, unknown>): number | null {
  if (!v || typeof v === "string") return null;
  if (typeof v === "object" && "confidence" in v) return (v as OcrExtractedField).confidence;
  return null;
}

const OCR_FIELD_META: Record<string, { label: string; icon: React.ReactNode; group: string }> = {
  insurer_name:      { label: "Insurer",             icon: <Shield className="h-3.5 w-3.5" />,       group: "Policy"   },
  policy_number:     { label: "Policy Number", icon: <Hash className="h-3.5 w-3.5" />,         group: "Policy"   },
  policy_name:       { label: "Plan Name",           icon: <Shield className="h-3.5 w-3.5" />,       group: "Policy"   },
  coverage_start:    { label: "Coverage Start",      icon: <Calendar className="h-3.5 w-3.5" />,     group: "Policy"   },
  coverage_end:      { label: "Coverage End",        icon: <Calendar className="h-3.5 w-3.5" />,     group: "Policy"   },
  group_sponsor:     { label: "Group / Sponsor",     icon: <Building2 className="h-3.5 w-3.5" />,    group: "Policy"   },
  pre_auth_number:   { label: "Pre-Auth Number",     icon: <Hash className="h-3.5 w-3.5" />,         group: "Policy"   },
  pre_auth_status:   { label: "Pre-Auth Status",     icon: <Shield className="h-3.5 w-3.5" />,       group: "Policy"   },
  certificate_number:{ label: "Certificate Number",  icon: <Hash className="h-3.5 w-3.5" />,         group: "Policy"   },
  tpa_id:            { label: "TPA ID",              icon: <Hash className="h-3.5 w-3.5" />,         group: "Policy"   },
  primary_insured_name: { label: "Primary Insured",  icon: <User className="h-3.5 w-3.5" />,         group: "Patient"  },
  primary_insured_phone: { label: "Insured Phone",   icon: <Phone className="h-3.5 w-3.5" />,        group: "Patient"  },
  primary_insured_email: { label: "Insured Email",   icon: <Mail className="h-3.5 w-3.5" />,         group: "Patient"  },
  sum_insured:       { label: "Sum Insured",         icon: <Hash className="h-3.5 w-3.5" />,         group: "Policy"   },
  hospitalized_person_name: { label: "Hospitalized Person", icon: <User className="h-3.5 w-3.5" />, group: "Patient"  },
  emirates_id:       { label: "Emirates ID",         icon: <User className="h-3.5 w-3.5" />,         group: "Patient"  },
  gender:            { label: "Gender",              icon: <User className="h-3.5 w-3.5" />,         group: "Patient"  },
  relationship_to_primary_insured: { label: "Relationship", icon: <User className="h-3.5 w-3.5" />,  group: "Patient"  },
  occupation:        { label: "Occupation",          icon: <User className="h-3.5 w-3.5" />,         group: "Patient"  },
  member_nationality:{ label: "Nationality",         icon: <User className="h-3.5 w-3.5" />,         group: "Patient"  },
  emirate:           { label: "Emirate",             icon: <MapPin className="h-3.5 w-3.5" />,       group: "Patient"  },
  patient_address:   { label: "Patient Address",     icon: <MapPin className="h-3.5 w-3.5" />,       group: "Patient"  },
  contact_number:    { label: "Contact Number",      icon: <Phone className="h-3.5 w-3.5" />,        group: "Patient"  },
  email_address:     { label: "Email",               icon: <Mail className="h-3.5 w-3.5" />,         group: "Patient"  },
  hospital_name:     { label: "Hospital Name",       icon: <Building2 className="h-3.5 w-3.5" />,   group: "Provider" },
  room_category:     { label: "Room Category",       icon: <Building2 className="h-3.5 w-3.5" />,   group: "Provider" },
  hospitalisation_due_to: { label: "Hospitalisation Due To", icon: <Stethoscope className="h-3.5 w-3.5" />, group: "Provider" },
  date_of_injury_or_detection: { label: "Injury / Detection Date", icon: <Calendar className="h-3.5 w-3.5" />, group: "Provider" },
  treating_physician:{ label: "Treating Physician",  icon: <Stethoscope className="h-3.5 w-3.5" />, group: "Provider" },
  physician_license: { label: "Physician License",   icon: <Hash className="h-3.5 w-3.5" />,        group: "Provider" },
  hospital_address:  { label: "Hospital Address",    icon: <MapPin className="h-3.5 w-3.5" />,      group: "Provider" },
  hospital_license:  { label: "Hospital License",    icon: <Hash className="h-3.5 w-3.5" />,        group: "Provider" },
  bank_name:         { label: "Bank Name",           icon: <Building2 className="h-3.5 w-3.5" />,   group: "Banking"  },
  iban:              { label: "IBAN / Account Number",icon: <Hash className="h-3.5 w-3.5" />,        group: "Banking"  },
  account_number:    { label: "Account Number",      icon: <Hash className="h-3.5 w-3.5" />,        group: "Banking"  },
  ifsc_code:         { label: "IFSC Code",           icon: <Hash className="h-3.5 w-3.5" />,        group: "Banking"  },
  pan_number:        { label: "PAN",                 icon: <Hash className="h-3.5 w-3.5" />,        group: "Banking"  },
  bank_account_holder: { label: "Account Holder",    icon: <User className="h-3.5 w-3.5" />,         group: "Banking"  },
  total_claim_amount:{ label: "Total Claim",         icon: <Hash className="h-3.5 w-3.5" />,        group: "Policy"   },
  pre_hospitalisation_expenses: { label: "Pre-Hospitalisation", icon: <Hash className="h-3.5 w-3.5" />, group: "Policy" },
  hospitalisation_expenses: { label: "Hospitalisation Expenses", icon: <Hash className="h-3.5 w-3.5" />, group: "Policy" },
  post_hospitalisation_expenses: { label: "Post-Hospitalisation", icon: <Hash className="h-3.5 w-3.5" />, group: "Policy" },
  ambulance_charges: { label: "Ambulance Charges",   icon: <Hash className="h-3.5 w-3.5" />,        group: "Policy"   },
};

function OcrDataPanel({
  data,
  claim,
}: {
  data?: OcrExtractedData;
  claim: import("@/lib/types").ClaimResponse;
}) {
  // ── Attempt to populate groups from OCR extracted data ──────────────────────
  const ocrGroups: Record<string, Array<{ key: string; label: string; icon: React.ReactNode; value: string; conf: number | null }>> = {
    Policy: [], Patient: [], Provider: [], Banking: [],
  };

  if (data) {
    for (const [key, meta] of Object.entries(OCR_FIELD_META)) {
      const raw   = data[key as keyof OcrExtractedData];
      const value = getFieldValue(raw as OcrExtractedField | string | undefined | Record<string, unknown>);
      if (value) {
        ocrGroups[meta.group]?.push({
          key, label: meta.label, icon: meta.icon, value,
          conf: getFieldConf(raw as OcrExtractedField | string | undefined | Record<string, unknown>),
        });
      }
    }
  }

  // Fallback for banking info from claim.validation_signals if not in data
  if (ocrGroups.Banking.length === 0 && claim.validation_signals?.bank_details) {
    const details = claim.validation_signals.bank_details as Record<string, unknown>;
    const bankName = getFieldValue(details.bank_name as OcrExtractedField | string | undefined);
    const iban = getFieldValue(details.iban as OcrExtractedField | string | undefined)
              || getFieldValue(details.account_number as OcrExtractedField | string | undefined);
    const holder = getFieldValue(details.bank_account_holder as OcrExtractedField | string | undefined)
                || getFieldValue(details.account_holder_name as OcrExtractedField | string | undefined);
    if (bankName) ocrGroups.Banking.push({ key: "bank_name", label: "Bank Name", icon: <Building2 className="h-3.5 w-3.5" />, value: bankName, conf: null });
    if (iban)     ocrGroups.Banking.push({ key: "iban", label: "IBAN / Account Number", icon: <Hash className="h-3.5 w-3.5" />, value: iban, conf: null });
    if (holder)   ocrGroups.Banking.push({ key: "bank_account_holder", label: "Account Holder", icon: <User className="h-3.5 w-3.5" />, value: holder, conf: null });
  }

  const hasOcrFields = Object.values(ocrGroups).some((g) => g.length > 0);
  const ocr_meta     = data?._ocr_metadata;

  // ── Structured fallback groups from the claim object ─────────────────────────
  type FieldEntry = { key: string; label: string; icon: React.ReactNode; value: string };
  const structuredGroups: Record<string, FieldEntry[]> = { Policy: [], Patient: [], Provider: [], Banking: [] };

  const addField = (group: string, key: string, label: string, icon: React.ReactNode, value: string | undefined | null) => {
    if (value) structuredGroups[group].push({ key, label, icon, value });
  };

  addField("Policy",   "market_region",    "Market / Region",    <MapPin className="h-3.5 w-3.5" />,       claim.market_region);
  addField("Policy",   "claim_type",       "Claim Type",         <Shield className="h-3.5 w-3.5" />,       claim.claim_type);
  addField("Policy",   "preauth_number",   "Pre-Auth Number",    <Hash className="h-3.5 w-3.5" />,         claim.preauth_number);
  addField("Policy",   "service_date",     "Service Date",       <Calendar className="h-3.5 w-3.5" />,     claim.service_date);
  addField("Policy",   "admission_date",   "Admission Date",     <Calendar className="h-3.5 w-3.5" />,     claim.admission_date);
  addField("Policy",   "discharge_date",   "Discharge Date",     <Calendar className="h-3.5 w-3.5" />,     claim.discharge_date);
  addField("Policy",   "diagnosis",        "Primary Diagnosis",  <Stethoscope className="h-3.5 w-3.5" />,
    claim.primary_diagnosis_code
      ? `${claim.primary_diagnosis_code}${claim.primary_diagnosis_desc ? ` — ${claim.primary_diagnosis_desc}` : ""}`
      : undefined,
  );
  addField("Patient",  "patient_name",     "Patient Name",       <User className="h-3.5 w-3.5" />,         claim.patient_name);
  addField("Patient",  "member_number",    "Member Number",      <Hash className="h-3.5 w-3.5" />,         claim.member_number);
  addField("Provider", "provider_name",    "Provider",           <Building2 className="h-3.5 w-3.5" />,    claim.provider_name);
  addField("Provider", "provider_code",    "Provider Code",      <Hash className="h-3.5 w-3.5" />,         claim.provider_code);
  addField("Provider", "network_tier",     "Network Tier",       <Shield className="h-3.5 w-3.5" />,       claim.network_tier);

  // Add banking fields to structured fallback if available
  if (claim.validation_signals?.bank_details) {
    const details = claim.validation_signals.bank_details as Record<string, unknown>;
    addField("Banking", "bank_name", "Bank Name", <Building2 className="h-3.5 w-3.5" />, getFieldValue(details.bank_name as OcrExtractedField | string | undefined));
    addField("Banking", "iban", "IBAN / Account Number", <Hash className="h-3.5 w-3.5" />, getFieldValue(details.iban as OcrExtractedField | string | undefined) || getFieldValue(details.account_number as OcrExtractedField | string | undefined));
    addField("Banking", "bank_account_holder", "Account Holder", <User className="h-3.5 w-3.5" />, getFieldValue(details.bank_account_holder as OcrExtractedField | string | undefined) || getFieldValue(details.account_holder_name as OcrExtractedField | string | undefined));
  }

  // Some older persisted OCR payloads only include a partial OCR object, such as
  // banking fields. Keep those OCR fields, but backfill the core claim fields so
  // the OCR panel does not collapse to banking details only.
  if (hasOcrFields) {
    for (const [group, fields] of Object.entries(structuredGroups)) {
      const existingKeys = new Set(ocrGroups[group]?.map((field) => field.key) ?? []);
      for (const field of fields) {
        if (!existingKeys.has(field.key)) {
          ocrGroups[group]?.push({ ...field, conf: null });
        }
      }
    }
  }

  const renderFieldGrid = (
    fields: Array<{ key: string; label: string; icon: React.ReactNode; value: string; conf?: number | null }>
  ) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {fields.map(({ key, label, icon, value, conf }) => (
        <div key={key} className="flex items-start gap-2.5 glass-card rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
          <span className="mt-0.5 text-brand-primary shrink-0">{icon}</span>
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-wider text-white/35 mb-0.5">{label}</p>
            <p className="text-[13px] font-medium text-white/85 truncate" title={value}>{value}</p>
            {conf != null && (
              <p className="text-[10px] text-white/30 mt-0.5">conf {(conf * 100).toFixed(0)}%</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      {hasOcrFields ? (
        <>
          {/* OCR metadata banner */}
          {ocr_meta && (
            <div className="glass-card flex flex-wrap gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5 text-xs text-white/45">
              <span>Engine: <span className="font-mono text-white/75">{ocr_meta._ocr_engine ?? "—"}</span></span>
              <span>Confidence: <span className="text-white/75">{ocr_meta._ocr_confidence != null ? `${(ocr_meta._ocr_confidence * 100).toFixed(0)}%` : "—"}</span></span>
              {ocr_meta._ocr_low_confidence_fields?.length ? (
                <span>Low-conf: <span className="text-amber-400">{ocr_meta._ocr_low_confidence_fields.join(", ")}</span></span>
              ) : null}
            </div>
          )}
          {Object.entries(ocrGroups).map(([group, fields]) =>
            fields.length === 0 ? null : (
              <div key={group}>
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/35">{group}</h3>
                {renderFieldGrid(fields)}
              </div>
            )
          )}
        </>
      ) : (
        <>
          {/* Banner: explain why there's no OCR data */}
          <div className="glass-card flex items-start gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
            <ScanLine className="h-4 w-4 text-white/30 mt-0.5 shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-white/55">No PDF document attached</p>
              <p className="text-[11px] text-white/35 mt-0.5">
                This claim was submitted via structured form entry, so there are no document-extracted fields.
                Showing the structured claim data below.
              </p>
            </div>
          </div>

          {/* Structured claim data as fallback */}
          {Object.entries(structuredGroups).map(([group, fields]) =>
            fields.length === 0 ? null : (
              <div key={group}>
                <h3 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-white/35">{group}</h3>
                {renderFieldGrid(fields)}
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function PolicyDocumentsSection({ documents }: {
  documents: Array<{
    policy_id: string;
    tier: "NATIONAL" | "COMPANY";
    policy_name: string;
    insurer_name: string;
    clauses_referenced: number;
    has_pdf: boolean;
  }>;
}) {
  const nationalDocs = documents.filter((d) => d.tier === "NATIONAL");
  const companyDocs  = documents.filter((d) => d.tier === "COMPANY");

  const handleDownload = async (policyId: string, policyName: string) => {
    try {
      const { policyLibraryDownloadDocument } = await import("@/lib/api");
      const blob = await policyLibraryDownloadDocument(policyId);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${policyName.replace(/[^a-z0-9]/gi, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      void err;
    }
  };

  const TierSection = ({
    docs, tierLabel, colorClass,
  }: {
    docs: typeof documents;
    tierLabel: string;
    colorClass: string;
  }) =>
    docs.length === 0 ? null : (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${colorClass}`}>
            {tierLabel}
          </span>
          <span className="text-[11px] text-white/35">{docs.length} {docs.length === 1 ? "policy" : "policies"}</span>
        </div>
        {docs.map((doc) => (
          <div key={doc.policy_id} className="glass-card flex items-center justify-between gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white/85 truncate">{doc.policy_name}</p>
              <p className="text-[11px] text-white/45 mt-0.5">{doc.insurer_name}</p>
              <p className="text-[11px] text-white/30 mt-0.5">{doc.clauses_referenced} clause{doc.clauses_referenced !== 1 ? "s" : ""} referenced</p>
            </div>
            {doc.has_pdf && (
              <button
                onClick={() => handleDownload(doc.policy_id, doc.policy_name)}
                className="inline-flex items-center gap-1.5 shrink-0 rounded-xl border border-brand-primary/25 bg-brand-primary/10 px-3 py-1.5 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/20 hover:border-brand-primary/40 transition-all"
              >
                <Download className="h-3 w-3" />
                PDF
              </button>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-white/70">Policy Documents</h3>
      <TierSection docs={nationalDocs} tierLabel="Tier 1 · National / Regulatory" colorClass="border-blue-500/20 bg-blue-500/10 text-blue-400" />
      <TierSection docs={companyDocs}  tierLabel="Tier 2 · Company Policies"      colorClass="border-violet-500/20 bg-violet-500/10 text-violet-400" />
      {nationalDocs.length === 0 && companyDocs.length === 0 && (
        <p className="text-sm text-white/35 py-4">No policy documents available for this claim.</p>
      )}
    </div>
  );
}

function DocumentViewer({ url, reference }: { url: string; reference: string }) {
  const [docState, setDocState] = useState<"checking" | "found" | "not-found" | "error">("checking");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    fetch(url, { method: "HEAD", credentials: "include" })
      .then((r) => {
        if (r.ok) {
          setDocState("found");
        } else {
          setDocState("not-found");
          setErrorMessage(r.status === 404 ? "Document file not found on server" : `Server error: ${r.status} ${r.statusText}`);
        }
      })
      .catch((err) => {
        void err;
        setDocState("error");
        setErrorMessage("Failed to check document availability");
      });
  }, [url]);

  if (docState === "checking") {
    return (
      <div className="glass-card flex items-center justify-center h-40 rounded-xl border border-white/[0.07] bg-white/[0.02]">
        <span className="text-sm text-white/35">Checking for document…</span>
      </div>
    );
  }

  if (docState !== "found") {
    return (
      <div className="glass-card flex flex-col items-center justify-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-10 text-center">
        <FileText className="w-10 h-10 text-white/15" />
        <p className="text-sm font-medium text-white/50">No document available</p>
        <p className="text-xs text-white/30">{errorMessage || "This claim was submitted without a PDF document."}</p>
        <p className="text-xs text-white/25 mt-1">
          Ref: <span className="font-mono text-white/40">{reference}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl border border-white/[0.08] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-brand-primary/10 border-b border-brand-primary/20">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-brand-primary" />
          <span className="text-sm font-semibold text-white/80">Original Claim Document</span>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.06] px-3 py-1.5 text-[11px] font-medium text-white/60 hover:bg-white/[0.10] hover:text-white/85 transition-all"
        >
          <ExternalLink className="h-3 w-3" />
          Open in tab
        </a>
      </div>

      {/* PDF embed */}
      <object
        data={url}
        type="application/pdf"
        className="w-full block bg-[#0d0d0f]"
        style={{ height: "72vh" }}
      >
        <iframe src={url} title={`Document — ${reference}`} className="w-full h-full border-none" style={{ height: "72vh" }} />
      </object>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/[0.02] border-t border-white/[0.07]">
        <span className="text-[11px] text-white/30">{reference}.pdf · Use download if PDF does not display</span>
        <a
          href={url}
          download={`${reference}.pdf`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-brand-primary/25 bg-brand-primary/10 px-3 py-1.5 text-[11px] font-semibold text-brand-primary hover:bg-brand-primary/20 transition-all"
        >
          <Download className="h-3 w-3" />
          Download PDF
        </a>
      </div>
    </div>
  );
}
