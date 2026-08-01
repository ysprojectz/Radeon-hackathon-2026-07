"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Hospital,
  IndianRupee,
  FileUp,
  Loader2,
  MapPin,
  Plus,
  Send,
  ShieldCheck,
  Stethoscope,
  Trash2,
  User,
} from "lucide-react";
import { getAdvanceClaimReferenceData, listAdvanceClaims, processAdvanceClaimDocuments, registerAdvanceClaim, uploadAdvanceClaimDocuments } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type {
  AdvanceClaimResponse,
  AdvanceDocumentProcessResponse,
  AdvanceDocumentUploadItem,
  ClaimLineItemCreate,
  IndiaCashlessReferenceData,
  IndiaHospitalReference,
} from "@/lib/types";
import { GraphTrace } from "@/components/india/GraphTrace";

// ── Service health bar ────────────────────────────────────────────────────────

interface PipelineComponentStatus {
  name: string;
  status: "active" | "attention" | "offline" | "unknown";
  detail?: string;
}

interface PipelineHealthComponentPayload {
  name?: string;
  status?: string;
  http?: number;
  detail?: string;
  error?: string;
}

interface PipelineHealthPayload {
  overall?: string;
  components?: PipelineHealthComponentPayload[];
  [key: string]: unknown;
}

const PIPELINE_COMPONENTS = [
  "APISIX",
  "Keycloak",
  "HAPI FHIR",
  "Document AI",
  "OPA",
  "FWA",
] as const;

const PIPELINE_COMPONENT_KEY_MAP: Record<string, string> = {
  APISIX: "apisix",
  Keycloak: "keycloak",
  Operaton: "operaton",
  "HAPI FHIR": "hapi_fhir",
  "Document AI": "document_ai",
  OPA: "opa",
  FWA: "fwa",
};

function normalizePipelineStatus(status?: string): PipelineComponentStatus["status"] {
  const value = String(status || "").toLowerCase();
  if (["up", "healthy", "ok", "ready", "active"].includes(value)) return "active";
  if (["degraded", "warning", "warn"].includes(value)) return "attention";
  if (["down", "unhealthy", "failed", "offline"].includes(value)) return "offline";
  return "unknown";
}

function statusLabel(status: PipelineComponentStatus["status"]) {
  if (status === "active") return "Active";
  if (status === "attention") return "Attention";
  if (status === "offline") return "Down";
  return "Unknown";
}

function PipelineHealthBar() {
  const [components, setComponents] = useState<PipelineComponentStatus[]>(
    PIPELINE_COMPONENTS.map((name) => ({ name, status: "unknown" }))
  );
  const [loading, setLoading] = useState(true);
  const [overall, setOverall] = useState("Checking");
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/proxy/india/pipeline/health", { credentials: "include" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("unauthorized");
        return response.json() as Promise<PipelineHealthPayload>;
      })
      .then((data) => {
        if (cancelled) return;
        const byName = new Map(
          (data.components ?? []).map((component) => [
            String(component.name || "").toLowerCase(),
            component,
          ])
        );
        setComponents(
          PIPELINE_COMPONENTS.map((name) => {
            const component =
              byName.get(name.toLowerCase()) ??
              byName.get(name === "FWA" ? "fwa service" : name.toLowerCase());
            const flatStatus = data[PIPELINE_COMPONENT_KEY_MAP[name]];
            const status = normalizePipelineStatus(
              component?.status ?? (typeof flatStatus === "string" ? flatStatus : undefined)
            );
            const detail = component?.error
              ? component.error
              : component?.http
              ? `HTTP ${component.http}`
              : component?.detail
              ? component.detail
              : undefined;
            return { name, status, detail };
          })
        );
        setOverall(String(data.overall || "checked"));
        setLastChecked(new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => {
        if (!cancelled) {
          setComponents(
            PIPELINE_COMPONENTS.map((name) => ({ name, status: "unknown" }))
          );
          setOverall("unavailable");
          setLastChecked(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = components.reduce(
    (acc, component) => {
      acc[component.status] += 1;
      return acc;
    },
    { active: 0, attention: 0, offline: 0, unknown: 0 }
  );
  const hasIssue = counts.attention + counts.offline > 0;

  return (
    <section className="glass-card px-4 py-3" aria-label="Service health status">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-2 flex min-w-[150px] flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
            Service Health
          </span>
          <span
            className={cn(
              "text-xs font-semibold",
              loading
                ? "text-text-muted"
                : hasIssue
                ? "text-[var(--status-warning)]"
                : "text-[var(--status-success)]"
            )}
          >
            {loading
              ? "Checking live status"
              : `${counts.active}/${components.length} active${hasIssue ? ` · ${counts.attention + counts.offline} attention` : ""}`}
          </span>
        </div>
        {loading
          ? PIPELINE_COMPONENTS.map((name) => (
              <div
                key={name}
                className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-1.5 animate-pulse"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-[var(--acos-surface)]" />
                <span className="text-xs text-text-muted">{name}</span>
                <span className="text-[10px] uppercase tracking-wider text-text-muted">Checking</span>
              </div>
            ))
          : components.map(({ name, status }) => (
              <div
                key={name}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-1.5",
                  status === "active"
                    ? "border-[var(--status-success)]/20 bg-[var(--status-success)]/10"
                    : status === "attention"
                    ? "border-[var(--status-warning)]/25 bg-[var(--status-warning)]/10"
                    : status === "offline"
                    ? "border-[var(--status-danger)]/25 bg-[var(--status-danger)]/10"
                    : "border-[var(--border-subtle)] bg-[var(--acos-surface)]"
                )}
                title={components.find((component) => component.name === name)?.detail ?? statusLabel(status)}
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    status === "active"
                      ? "bg-[var(--status-success)]"
                      : status === "attention"
                      ? "bg-[var(--status-warning)]"
                      : status === "offline"
                      ? "bg-[var(--status-danger)]"
                      : "bg-[var(--acos-surface-strong)]"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    status === "active"
                      ? "text-[var(--status-success)]"
                      : status === "attention"
                      ? "text-[var(--status-warning)]"
                      : status === "offline"
                      ? "text-[var(--status-danger)]"
                      : "text-text-muted"
                  )}
                >
                  {name}
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {statusLabel(status)}
                </span>
              </div>
            ))}
        {!loading && (
          <span className="ml-auto text-[10px] uppercase tracking-widest text-text-muted">
            {overall} {lastChecked ? `· ${lastChecked}` : ""}
          </span>
        )}
      </div>
    </section>
  );
}

const FALLBACK_REFERENCE_DATA: IndiaCashlessReferenceData = {
  version: "fallback",
  hospitals: [
    { code: "IND-001", name: "Apollo Hospitals, Greams Road", state: "Tamil Nadu", city: "Chennai", tier: "NETWORK" },
    { code: "IND-002", name: "Fortis Hospital, Bannerghatta Road", state: "Karnataka", city: "Bangalore", tier: "NETWORK" },
    { code: "IND-003", name: "Max Super Speciality Hospital, Saket", state: "Delhi", city: "New Delhi", tier: "NETWORK" },
    { code: "IND-004", name: "Kokilaben Dhirubhai Ambani Hospital", state: "Maharashtra", city: "Mumbai", tier: "NETWORK" },
  ],
  treatment_doctors: [
    { name: "Dr. Amit Sharma", specialty: "Urology", state: "Delhi", hospital_codes: ["IND-003"] },
    { name: "Dr. Priya Nair", specialty: "Cardiology", state: "Kerala", hospital_codes: [] },
    { name: "Dr. Rajesh Iyer", specialty: "Orthopaedics", state: "Tamil Nadu", hospital_codes: ["IND-001"] },
  ],
  primary_diagnoses: [
    { code: "N39.0", desc: "Urinary tract infection" },
    { code: "I21.9", desc: "Acute myocardial infarction" },
    { code: "J45.9", desc: "Asthma" },
    { code: "E11.9", desc: "Type 2 diabetes mellitus" },
  ],
  procedures: [
    { code: "CONSULT", name: "Specialist consultation", category: "CONSULTATION" },
    { code: "TURP", name: "Transurethral resection", category: "SURGERY" },
    { code: "CABG", name: "Coronary artery bypass graft", category: "SURGERY" },
  ],
  banks: [
    { name: "HDFC Bank", ifsc_prefix: "HDFC" },
    { name: "ICICI Bank", ifsc_prefix: "ICIC" },
    { name: "State Bank of India", ifsc_prefix: "SBIN" },
  ],
};

interface LineItem {
  line_number: number;
  procedure_code: string;
  procedure_desc: string;
  service_category: string;
  billed_amount: number;
}

interface AdvanceClaimForm {
  claim_type: string;
  patient_name: string;
  patient_dob: string;
  member_number: string;
  provider_code: string;
  provider_name: string;
  admission_date: string;
  discharge_date: string;
  primary_diagnosis_code: string;
  treating_doctor: string;
  estimated_total: number;
  account_holder_name: string;
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  upi_vpa: string;
  line_items: LineItem[];
}

const emptyForm: AdvanceClaimForm = {
  claim_type: "INPATIENT",
  patient_name: "",
  patient_dob: "",
  member_number: "",
  provider_code: "",
  provider_name: "",
  admission_date: "",
  discharge_date: "",
  primary_diagnosis_code: "",
  treating_doctor: "",
  estimated_total: 0,
  account_holder_name: "",
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  upi_vpa: "",
  line_items: [],
};

const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--acos-surface)] px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-brand-primary/50 focus:bg-[var(--acos-surface-strong)]";
const selectClass = cn(fieldClass, "appearance-none");
const labelClass = "ui-control-label mb-1.5 block text-text-muted";

function currency(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  return `INR ${Number.isFinite(numeric) ? numeric.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}`;
}

function statusTone(status: string) {
  if (status === "APPROVED") return "border-[var(--status-success)]/25 bg-[var(--status-success)]/10 text-[var(--status-success)]";
  if (status === "PENDING_HITL") return "border-[var(--status-warning)]/25 bg-[var(--status-warning)]/10 text-[var(--status-warning)]";
  if (status === "DENIED") return "border-[var(--status-danger)]/25 bg-[var(--status-danger)]/10 text-[var(--status-danger)]";
  return "border-[var(--border-subtle)] bg-[var(--acos-surface-strong)] text-text-secondary";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const INDIA_CASHLESS_PIPELINE = ["APISIX", "Keycloak", "Operaton BPMN", "HAPI FHIR", "Document AI", "OPA", "FWA"];

const REQUIRED_ADVANCE_FIELD_LABELS: Record<string, string> = {
  member_number: "Member ID",
  patient_name: "Patient Name",
  patient_dob: "DOB",
  provider_code: "Provider Code",
  provider_name: "Hospital",
  admission_date: "Admission Date",
  primary_diagnosis_code: "Primary Diagnosis",
  treating_doctor: "Treating Doctor",
  line_items: "Treatment line items",
};

function isFilled(value: string | number | null | undefined) {
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function normalizeProviderText(value: string) {
  return value
    .toLowerCase()
    .replace(/\bhospital details\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeReferenceText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findHospitalLocation(
  hospitals: IndiaHospitalReference[],
  providerName?: string | null,
  providerCode?: string | null
) {
  const normalizedName = normalizeProviderText(providerName ?? "");
  const normalizedCode = (providerCode ?? "").trim().toUpperCase();

  for (const hospital of hospitals) {
    const codeMatch = normalizedCode && hospital.code.toUpperCase() === normalizedCode;
    const candidates = [hospital.name, ...(hospital.aliases ?? [])].map(normalizeProviderText);
    const nameMatch =
      normalizedName &&
      candidates.some(
        (candidate) =>
          candidate === normalizedName ||
          candidate.includes(normalizedName) ||
          normalizedName.includes(candidate)
      );
    if (codeMatch || nameMatch) {
      return { state: hospital.state, city: hospital.city, hospital };
    }
  }
  return null;
}

function normalizeExtractedLineItems(items: ClaimLineItemCreate[] | undefined): LineItem[] {
  return (items ?? [])
    .map((item, index) => ({
      line_number: index + 1,
      procedure_code: String(item.procedure_code || "PROC"),
      procedure_desc: String(item.procedure_desc || item.procedure_code || "Extracted procedure"),
      service_category: String(item.service_category || "OTHER"),
      billed_amount: Number(item.billed_amount || 0),
    }))
    .filter((item) => item.billed_amount > 0);
}

function findDiagnosis(
  referenceData: IndiaCashlessReferenceData,
  diagnosisCode?: unknown,
  diagnosisDesc?: unknown
) {
  const normalizedCode = String(diagnosisCode ?? "").trim().toUpperCase();
  const normalizedDesc = normalizeReferenceText(diagnosisDesc);

  const codeMatch = referenceData.primary_diagnoses.find(
    (diagnosis) => diagnosis.code.toUpperCase() === normalizedCode
  );
  if (codeMatch) return codeMatch;

  if (!normalizedDesc) return null;
  return (
    referenceData.primary_diagnoses.find((diagnosis) => {
      const candidates = [diagnosis.desc, ...(diagnosis.aliases ?? [])].map(normalizeReferenceText);
      return candidates.some(
        (candidate) =>
          candidate.length >= 3 &&
          (normalizedDesc === candidate ||
            normalizedDesc.includes(candidate) ||
            candidate.includes(normalizedDesc))
      );
    }) ?? null
  );
}

function SectionHeader({ icon: Icon, eyebrow, title }: { icon: typeof User; eyebrow: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-primary/20 bg-brand-primary/10 text-brand-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="ui-eyebrow text-text-muted">{eyebrow}</p>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      </div>
    </div>
  );
}

export default function ClaimsAdvancePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("new");
  const [formData, setFormData] = useState<AdvanceClaimForm>(emptyForm);
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [newLineItem, setNewLineItem] = useState({ procedure_code: "", procedure_desc: "", service_category: "CONSULTATION", billed_amount: 0 });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<AdvanceClaimResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const [isProcessingDocs, setIsProcessingDocs] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState<AdvanceDocumentUploadItem[]>([]);
  const [documentProcessResult, setDocumentProcessResult] = useState<AdvanceDocumentProcessResponse | null>(null);
  const [history, setHistory] = useState<AdvanceClaimResponse[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [referenceData, setReferenceData] = useState<IndiaCashlessReferenceData>(FALLBACK_REFERENCE_DATA);
  const [referenceLoading, setReferenceLoading] = useState(true);

  const indianStates = useMemo(
    () => Array.from(new Set(referenceData.hospitals.map((hospital) => hospital.state))).sort(),
    [referenceData.hospitals]
  );
  const citiesForSelectedState = useMemo(
    () =>
      selectedState
        ? Array.from(
            new Set(
              referenceData.hospitals
                .filter((hospital) => hospital.state === selectedState)
                .map((hospital) => hospital.city)
            )
          ).sort()
        : [],
    [referenceData.hospitals, selectedState]
  );
  const selectedCityHospitals = useMemo(
    () => referenceData.hospitals.filter((hospital) => hospital.city === selectedCity),
    [referenceData.hospitals, selectedCity]
  );
  const selectedDiagnosis = referenceData.primary_diagnoses.find((d) => d.code === formData.primary_diagnosis_code);
  const lineCount = formData.line_items.length;
  const hospitalTier = selectedCityHospitals.find((h) => h.name === formData.provider_name)?.tier ?? "Pending";
  const doctorOptions = useMemo(() => {
    const hospitalScoped = formData.provider_code
      ? referenceData.treatment_doctors.filter((doctor) => doctor.hospital_codes?.includes(formData.provider_code))
      : [];
    if (hospitalScoped.length > 0) return hospitalScoped;
    const stateScoped = selectedState
      ? referenceData.treatment_doctors.filter((doctor) => doctor.state === selectedState)
      : [];
    return stateScoped.length > 0 ? stateScoped : referenceData.treatment_doctors;
  }, [formData.provider_code, referenceData.treatment_doctors, selectedState]);

  const requiredComplete = useMemo(() => {
    const required = [
      formData.member_number,
      formData.patient_name,
      formData.patient_dob,
      formData.provider_code,
      formData.provider_name,
      formData.admission_date,
      formData.primary_diagnosis_code,
      formData.treating_doctor,
    ];
    return required.filter(Boolean).length;
  }, [formData]);

  const missingRequiredFields = useMemo(() => {
    const missing: string[] = [];
    if (!isFilled(formData.member_number)) missing.push("member_number");
    if (!isFilled(formData.patient_name)) missing.push("patient_name");
    if (!isFilled(formData.patient_dob)) missing.push("patient_dob");
    if (!isFilled(formData.provider_code)) missing.push("provider_code");
    if (!isFilled(formData.provider_name)) missing.push("provider_name");
    if (!isFilled(formData.admission_date)) missing.push("admission_date");
    if (!isFilled(formData.primary_diagnosis_code)) missing.push("primary_diagnosis_code");
    if (!isFilled(formData.treating_doctor)) missing.push("treating_doctor");
    if (formData.line_items.length === 0) missing.push("line_items");
    return missing;
  }, [formData]);

  const missingHeaderFieldLabels = useMemo(
    () =>
      missingRequiredFields
        .filter((field) => field !== "line_items")
        .map((field) => REQUIRED_ADVANCE_FIELD_LABELS[field]),
    [missingRequiredFields]
  );

  const canSubmit = missingRequiredFields.length === 0 && !isSubmitting && !isUploadingDocs && !isProcessingDocs;

  useEffect(() => {
    let cancelled = false;
    setReferenceLoading(true);
    getAdvanceClaimReferenceData()
      .then((data) => {
        if (!cancelled) setReferenceData(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReferenceData(FALLBACK_REFERENCE_DATA);
          setError(err instanceof Error ? `Reference library unavailable: ${err.message}` : "Reference library unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setReferenceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "history") return;

    let cancelled = false;
    setHistoryLoading(true);
    listAdvanceClaims({ skip: 0, limit: 50 })
      .then((data) => {
        if (!cancelled) setHistory(data.claims ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load advance claims");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const addLineItem = () => {
    if (!newLineItem.procedure_code || !newLineItem.procedure_desc || newLineItem.billed_amount <= 0) {
      setError("Please fill all line item fields");
      return;
    }
    const updatedItems = [...formData.line_items, { ...newLineItem, line_number: formData.line_items.length + 1 }];
    const total = updatedItems.reduce((sum, item) => sum + item.billed_amount, 0);
    setFormData({ ...formData, line_items: updatedItems, estimated_total: total });
    setNewLineItem({ procedure_code: "", procedure_desc: "", service_category: "CONSULTATION", billed_amount: 0 });
    setError(null);
  };

  const removeLineItem = (index: number) => {
    const updatedItems = formData.line_items
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, line_number: i + 1 }));
    const total = updatedItems.reduce((sum, item) => sum + item.billed_amount, 0);
    setFormData({ ...formData, line_items: updatedItems, estimated_total: total });
  };

  const handleDocumentUpload = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;

    setIsUploadingDocs(true);
    setError(null);
    try {
      const data = await uploadAdvanceClaimDocuments(selectedFiles);
      setUploadedDocs((current) => [...current, ...data.documents]);
      setDocumentProcessResult(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload documents");
    } finally {
      setIsUploadingDocs(false);
    }
  };

  const removeUploadedDocument = (documentUrl: string) => {
    setUploadedDocs((current) => current.filter((doc) => doc.document_url !== documentUrl));
    setDocumentProcessResult(null);
  };

  const handleProcessDocuments = async () => {
    if (uploadedDocs.length === 0) {
      setError("Upload at least one India pre-auth document first");
      return;
    }

    setIsProcessingDocs(true);
    setError(null);
    setSuccess(null);
    try {
      const data = await processAdvanceClaimDocuments(uploadedDocs.map((doc) => doc.document_url));
      const extracted = data.extracted_fields;
      const location = findHospitalLocation(
        referenceData.hospitals,
        typeof extracted.provider_name === "string" ? extracted.provider_name : undefined,
        typeof extracted.provider_code === "string" ? extracted.provider_code : undefined
      );
      const extractedState = typeof extracted.provider_state === "string" ? extracted.provider_state : "";
      const extractedCity = typeof extracted.provider_city === "string" ? extracted.provider_city : "";
      const diagnosisMatch = findDiagnosis(
        referenceData,
        extracted.primary_diagnosis_code,
        extracted.primary_diagnosis_desc
      );

      if (location) {
        setSelectedState(location.state);
        setSelectedCity(location.city);
      } else {
        if (extractedState) setSelectedState(extractedState);
        if (extractedCity) setSelectedCity(extractedCity);
      }

      setFormData((current) => {
        const next: AdvanceClaimForm = { ...current };
        const assign = (field: keyof AdvanceClaimForm, value: unknown) => {
          if (!isFilled(next[field] as string | number | undefined) && isFilled(value as string | number | undefined)) {
            next[field] = String(value) as never;
          }
        };

        const extractedClaimType = typeof extracted.claim_type === "string" ? extracted.claim_type : "";
        if (["INPATIENT", "DAYCARE", "MATERNITY"].includes(extractedClaimType)) {
          next.claim_type = extractedClaimType;
        }

        assign("member_number", extracted.member_number);
        assign("patient_name", extracted.patient_name);
        assign("patient_dob", extracted.patient_dob);
        assign("admission_date", extracted.admission_date);
        assign("discharge_date", extracted.discharge_date);
        assign("treating_doctor", extracted.treating_doctor);
        assign("account_holder_name", extracted.account_holder_name || extracted.bank_account_holder);
        assign("bank_name", extracted.bank_name);
        assign("account_number", extracted.account_number);
        assign("ifsc_code", extracted.ifsc_code);
        assign("upi_vpa", extracted.upi_vpa);

        if (!next.primary_diagnosis_code && diagnosisMatch) {
          next.primary_diagnosis_code = diagnosisMatch.code;
        } else {
          assign("primary_diagnosis_code", extracted.primary_diagnosis_code);
        }

        if (location) {
          next.provider_name = location.hospital.name;
          next.provider_code = location.hospital.code;
        } else {
          assign("provider_name", extracted.provider_name);
          assign("provider_code", extracted.provider_code);
        }

        const extractedItems = normalizeExtractedLineItems(extracted.line_items);
        if (next.line_items.length === 0 && extractedItems.length > 0) {
          next.line_items = extractedItems;
          next.estimated_total = extractedItems.reduce((sum, item) => sum + item.billed_amount, 0);
        } else if (next.estimated_total <= 0 && isFilled(extracted.estimated_total)) {
          next.estimated_total = Number(extracted.estimated_total);
        }

        return next;
      });

      setDocumentProcessResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Document processing failed");
    } finally {
      setIsProcessingDocs(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isUploadingDocs || isProcessingDocs) {
      setError(isUploadingDocs ? "Document upload is still running" : "Document processing is still running");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    if (missingRequiredFields.length > 0) {
      setError(`Please fill: ${missingRequiredFields.map((field) => REQUIRED_ADVANCE_FIELD_LABELS[field]).join(", ")}`);
      setIsSubmitting(false);
      return;
    }

    try {
      const data = await registerAdvanceClaim({
        ...formData,
        market_region: "INDIA",
        currency: "INR",
        estimated_total: formData.estimated_total.toString(),
        primary_diagnosis_desc: selectedDiagnosis?.desc,
        account_holder_name: formData.account_holder_name || formData.patient_name,
        bank_account_holder: formData.account_holder_name || formData.patient_name,
        bank_name: formData.bank_name || undefined,
        account_number: formData.account_number || undefined,
        ifsc_code: formData.ifsc_code || undefined,
        upi_vpa: formData.upi_vpa || undefined,
        supporting_docs: uploadedDocs.map((doc) => doc.document_url),
        line_items: formData.line_items.map((li) => ({
          ...li,
          billed_amount: li.billed_amount.toString(),
          units: "1",
          diagnosis_pointers: [1],
        })),
        source_channel: "INDIA_CASHLESS_PREAUTH",
      });
      setSuccess(data);
      setFormData(emptyForm);
      setUploadedDocs([]);
      setSelectedState("");
      setSelectedCity("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="acos-page">
      <PageHeader
        title="Pre Auth Claim"
        actions={
          <button
            type="button"
            onClick={() => router.push("/submit")}
            className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            Claim Submission
          </button>
        }
      />

      {/* Service health status bar */}
      <PipelineHealthBar />

      <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              label: "Fields",
              value: `${requiredComplete}/8`,
              icon: ClipboardList,
              note: missingHeaderFieldLabels.length > 0 ? `Missing: ${missingHeaderFieldLabels.join(", ")}` : "Ready",
            },
            {
              label: "Lines",
              value: String(lineCount),
              icon: FileCheck2,
              note: lineCount > 0 ? "Ready" : "Add treatment line",
            },
            { label: "Estimate", value: currency(formData.estimated_total), icon: IndianRupee, note: "INR" },
          ].map((item) => (
            <div key={item.label} className="glass-card min-w-0 px-3 py-3">
              <div className="flex items-center gap-2">
                <item.icon className="h-4 w-4 shrink-0 text-brand-primary" />
                <span className="ui-eyebrow truncate text-text-muted">{item.label}</span>
              </div>
              <p className="mt-2 truncate font-mono text-sm font-semibold text-text-primary">{item.value}</p>
              <p className="mt-1 truncate text-[10px] font-medium text-text-muted">{item.note}</p>
            </div>
          ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
        <TabsList className="h-12 w-full justify-start gap-0 overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-1 sm:w-auto">
          <TabsTrigger
            value="new"
            className="h-10 rounded-xl px-4 text-xs font-bold text-text-muted data-[state=active]:bg-brand-primary/15 data-[state=active]:text-brand-primary"
          >
            New Pre Auth Claim
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="h-10 rounded-xl px-4 text-xs font-bold text-text-muted data-[state=active]:bg-brand-primary/15 data-[state=active]:text-brand-primary"
          >
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="mt-0">
          <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="space-y-5">
              <section className="glass-card space-y-5 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <SectionHeader icon={FileUp} eyebrow="Pre Auth Claim" title="Supporting documents" />
                  <div className="flex flex-wrap gap-1.5">
                    {INDIA_CASHLESS_PIPELINE.map((step) => (
                      <span
                        key={step}
                        className="rounded-full border border-brand-primary/15 bg-brand-primary/8 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-primary/75"
                      >
                        {step}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-dashed border-brand-primary/25 bg-brand-primary/8 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-text-primary">India pre-auth intake channel</p>
                      <p className="mt-1 text-xs leading-5 text-text-muted">
                        Upload clinical PDFs or images before submission. Files are linked to the pre-auth payload for BPMN, FHIR extraction, rules, and FWA review.
                      </p>
                    </div>
                    <div className="shrink-0">
                      <input
                        id="advance-doc-upload"
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif"
                        className="sr-only"
                        onChange={async (event) => {
                          await handleDocumentUpload(event.currentTarget.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      <label
                        htmlFor="advance-doc-upload"
                        className={cn(
                          "ui-button-primary inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold",
                          isUploadingDocs && "pointer-events-none opacity-60"
                        )}
                      >
                        {isUploadingDocs ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="h-4 w-4" />
                        )}
                        {isUploadingDocs ? "Uploading" : "Upload Files"}
                      </label>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2 text-[11px] font-medium text-text-muted">
                      <span>PDF, JPG, PNG, TIFF</span>
                      <span>Max 15 MB each</span>
                      <span>10 files per upload</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleProcessDocuments}
                      disabled={uploadedDocs.length === 0 || isUploadingDocs || isProcessingDocs}
                      className="ui-button-secondary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isProcessingDocs ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FileCheck2 className="h-4 w-4" />
                      )}
                      {isProcessingDocs ? "Processing" : "Process Document"}
                    </button>
                  </div>
                </div>

                {uploadedDocs.length > 0 ? (
                  <div className="space-y-2">
                    {uploadedDocs.map((doc) => (
                      <div
                        key={doc.document_url}
                        className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-text-primary">{doc.original_filename}</p>
                          <p className="mt-1 font-mono text-[11px] text-text-muted">
                            {formatFileSize(doc.file_size_bytes)} | {doc.content_type ?? "document"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeUploadedDocument(doc.document_url)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--status-danger)]/15 bg-[var(--status-danger)]/10 text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger)]/18"
                          aria-label={`Remove ${doc.original_filename}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-4 py-4 text-sm font-medium text-text-muted">
                    No India pre-auth documents uploaded yet.
                  </div>
                )}

                {documentProcessResult && (
                  <div
                    className={cn(
                      "rounded-2xl border p-4",
                      missingRequiredFields.length === 0
                        ? "border-[var(--status-success)]/20 bg-[var(--status-success)]/8"
                        : "border-[var(--status-warning)]/20 bg-[var(--status-warning)]/8"
                    )}
                  >
                    <div className="flex gap-3">
                      {missingRequiredFields.length === 0 ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-success)]" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-warning)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            missingRequiredFields.length === 0 ? "text-[var(--status-success)]" : "text-[var(--status-warning)]"
                          )}
                        >
                          {missingRequiredFields.length === 0
                            ? "Document processed. Required details are ready."
                            : "Document processed. Fill the missing details."}
                        </p>
                        {documentProcessResult.documents_processed.length > 0 && (
                          <p className="mt-1 truncate font-mono text-[11px] text-text-muted">
                            {documentProcessResult.documents_processed.join(", ")}
                          </p>
                        )}
                        {missingRequiredFields.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {missingRequiredFields.map((field) => (
                              <span
                                key={field}
                                className="rounded-full border border-[var(--status-warning)]/20 bg-[var(--status-warning)]/10 px-2.5 py-1 text-[11px] font-semibold text-[var(--status-warning)]"
                              >
                                {REQUIRED_ADVANCE_FIELD_LABELS[field]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="glass-card space-y-5 p-5">
                <SectionHeader icon={User} eyebrow="Member" title="Patient details" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>Member ID *</label>
                    <input
                      type="text"
                      value={formData.member_number}
                      onChange={(e) => setFormData({ ...formData, member_number: e.target.value })}
                      className={fieldClass}
                      placeholder="IND-2024-100001"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Patient Name *</label>
                    <input
                      type="text"
                      value={formData.patient_name}
                      onChange={(e) => setFormData({ ...formData, patient_name: e.target.value })}
                      className={fieldClass}
                      placeholder="Patient full name"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>DOB *</label>
                    <input
                      type="date"
                      value={formData.patient_dob}
                      onChange={(e) => setFormData({ ...formData, patient_dob: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Treating Doctor *</label>
                    <input
                      type="text"
                      value={formData.treating_doctor}
                      onChange={(e) => setFormData({ ...formData, treating_doctor: e.target.value })}
                      className={fieldClass}
                      placeholder="Dr. Amit Sharma"
                      list="india-doctor-list"
                    />
                    <datalist id="india-doctor-list">
                      {doctorOptions.map((doctor) => (
                        <option key={`${doctor.name}-${doctor.specialty}`} value={doctor.name}>
                          {doctor.specialty}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>
              </section>

              <section className="glass-card space-y-5 p-5">
                <SectionHeader icon={Hospital} eyebrow="Network" title="Hospital details" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>State</label>
                    <select
                      value={selectedState}
                      onChange={(e) => {
                        setSelectedState(e.target.value);
                        setSelectedCity("");
                        setFormData({ ...formData, provider_code: "", provider_name: "" });
                      }}
                      className={selectClass}
                    >
                      <option value="">Select state</option>
                      {indianStates.map((state) => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>City</label>
                    <select
                      value={selectedCity}
                      onChange={(e) => {
                        setSelectedCity(e.target.value);
                        const hospital = referenceData.hospitals.find((item) => item.city === e.target.value);
                        setFormData({ ...formData, provider_code: hospital?.code ?? "", provider_name: hospital?.name ?? "" });
                      }}
                      className={selectClass}
                    >
                      <option value="">Select city</option>
                      {citiesForSelectedState.map((city) => (
                        <option key={city} value={city}>{city}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Hospital *</label>
                    <select
                      value={formData.provider_name}
                      onChange={(e) => {
                        const hospital = selectedCityHospitals.find((h) => h.name === e.target.value);
                        setFormData({ ...formData, provider_name: e.target.value, provider_code: hospital?.code || "" });
                      }}
                      className={selectClass}
                    >
                      <option value="">Select hospital</option>
                      {formData.provider_name && !selectedCityHospitals.some((hospital) => hospital.name === formData.provider_name) && (
                        <option value={formData.provider_name}>{formData.provider_name} (captured)</option>
                      )}
                      {selectedCityHospitals.map((hospital) => (
                        <option key={hospital.code} value={hospital.name}>
                          {hospital.name} ({hospital.tier})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Provider Code</label>
                    <input
                      type="text"
                      value={formData.provider_code}
                      readOnly
                      className={cn(fieldClass, "text-text-secondary")}
                      placeholder="Auto-filled"
                    />
                  </div>
                </div>
              </section>

              <section className="glass-card space-y-5 p-5">
                <SectionHeader icon={Calendar} eyebrow="Episode" title="Admission details" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className={labelClass}>Claim Type *</label>
                    <select
                      value={formData.claim_type}
                      onChange={(e) => setFormData({ ...formData, claim_type: e.target.value })}
                      className={selectClass}
                    >
                      <option value="INPATIENT">Inpatient</option>
                      <option value="DAYCARE">Daycare</option>
                      <option value="MATERNITY">Maternity</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Admission Date *</label>
                    <input
                      type="date"
                      value={formData.admission_date}
                      onChange={(e) => setFormData({ ...formData, admission_date: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Discharge Date</label>
                    <input
                      type="date"
                      value={formData.discharge_date}
                      onChange={(e) => setFormData({ ...formData, discharge_date: e.target.value })}
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Primary Diagnosis *</label>
                    <select
                      value={formData.primary_diagnosis_code}
                      onChange={(e) => setFormData({ ...formData, primary_diagnosis_code: e.target.value })}
                      className={selectClass}
                    >
                      <option value="">Select diagnosis</option>
                      {formData.primary_diagnosis_code && !referenceData.primary_diagnoses.some((diagnosis) => diagnosis.code === formData.primary_diagnosis_code) && (
                        <option value={formData.primary_diagnosis_code}>{formData.primary_diagnosis_code} - Captured</option>
                      )}
                      {referenceData.primary_diagnoses.map((diagnosis) => (
                        <option key={diagnosis.code} value={diagnosis.code}>
                          {diagnosis.code} - {diagnosis.desc}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="glass-card space-y-5 p-5">
                <SectionHeader icon={ShieldCheck} eyebrow="Payout" title="Account details" />
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <label className="ui-control-label block text-text-muted">Account Holder</label>
                      {formData.patient_name && !formData.account_holder_name && (
                        <button
                          type="button"
                          onClick={() => setFormData({ ...formData, account_holder_name: formData.patient_name })}
                          className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand-primary/75 hover:text-brand-primary"
                        >
                          Same as patient
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={formData.account_holder_name}
                      onChange={(e) => setFormData({ ...formData, account_holder_name: e.target.value })}
                      className={fieldClass}
                      placeholder="Name on account"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Bank Name</label>
                    <input
                      type="text"
                      value={formData.bank_name}
                      onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                      className={fieldClass}
                      placeholder="HDFC Bank"
                      list="india-bank-list"
                    />
                    <datalist id="india-bank-list">
                      {referenceData.banks.map((bank) => (
                        <option key={bank.name} value={bank.name}>
                          {bank.ifsc_prefix ?? ""}
                        </option>
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className={labelClass}>Account Number</label>
                    <input
                      type="text"
                      value={formData.account_number}
                      onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                      className={fieldClass}
                      placeholder="Stored masked/encrypted"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>IFSC Code</label>
                    <input
                      type="text"
                      value={formData.ifsc_code}
                      onChange={(e) => setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() })}
                      className={fieldClass}
                      placeholder="HDFC0001234"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelClass}>UPI/VPA Alternative</label>
                    <input
                      type="text"
                      value={formData.upi_vpa}
                      onChange={(e) => setFormData({ ...formData, upi_vpa: e.target.value })}
                      className={fieldClass}
                      placeholder="name@paytm"
                    />
                  </div>
                </div>
              </section>

              <section className="glass-card space-y-5 p-5">
                <SectionHeader icon={Stethoscope} eyebrow="Estimate" title="Treatment line items" />
                <div className="grid gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-3 md:grid-cols-[1fr_1.4fr_1fr_1fr_auto]">
                  <input
                    placeholder="Code"
                    value={newLineItem.procedure_code}
                    onChange={(e) => setNewLineItem({ ...newLineItem, procedure_code: e.target.value })}
                    className={fieldClass}
                    list="procedures-list"
                  />
                  <datalist id="procedures-list">
                    {referenceData.procedures.map((procedure) => (
                      <option key={procedure.code} value={procedure.code}>{procedure.name}</option>
                    ))}
                  </datalist>
                  <input
                    placeholder="Description"
                    value={newLineItem.procedure_desc}
                    onChange={(e) => setNewLineItem({ ...newLineItem, procedure_desc: e.target.value })}
                    className={fieldClass}
                  />
                  <select
                    value={newLineItem.service_category}
                    onChange={(e) => setNewLineItem({ ...newLineItem, service_category: e.target.value })}
                    className={selectClass}
                  >
                    <option value="CONSULTATION">Consultation</option>
                    <option value="SURGERY">Surgery</option>
                    <option value="DIAGNOSTIC">Diagnostic</option>
                    <option value="PHARMACY">Pharmacy</option>
                    <option value="ROOM_RENT">Room Rent</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    placeholder="Amount"
                    value={newLineItem.billed_amount || ""}
                    onChange={(e) => setNewLineItem({ ...newLineItem, billed_amount: Number(e.target.value) })}
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="ui-button-primary h-11 rounded-xl px-4 text-sm font-semibold"
                  >
                    <Plus className="h-4 w-4" />
                    Add
                  </button>
                </div>

                {formData.line_items.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
                    <div className="scrollbar-styled overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm">
                        <thead className="bg-[var(--acos-surface)] text-left">
                          <tr className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted">
                            <th className="px-4 py-3">#</th>
                            <th className="px-4 py-3">Procedure</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3">Category</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.line_items.map((item, index) => (
                            <tr key={`${item.line_number}-${item.procedure_code}`} className="border-t border-[var(--border-subtle)] text-text-secondary">
                              <td className="px-4 py-3 font-mono text-text-muted">{item.line_number}</td>
                              <td className="px-4 py-3 font-mono font-semibold text-brand-primary">{item.procedure_code}</td>
                              <td className="px-4 py-3 text-text-primary">{item.procedure_desc}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-2.5 py-1 text-[11px] font-semibold text-text-secondary">
                                  {item.service_category}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-semibold text-text-primary">{currency(item.billed_amount)}</td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => removeLineItem(index)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--status-danger)]/15 bg-[var(--status-danger)]/10 text-[var(--status-danger)] transition-colors hover:bg-[var(--status-danger)]/18"
                                  aria-label="Remove line item"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t border-brand-primary/20 bg-brand-primary/8">
                          <tr>
                            <td colSpan={4} className="px-4 py-4 text-right text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Total</td>
                            <td className="px-4 py-4 text-right font-mono text-base font-black text-brand-primary">{currency(formData.estimated_total)}</td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center">
                    <FileCheck2 className="mx-auto h-6 w-6 text-text-muted" />
                    <p className="mt-2 text-sm font-semibold text-text-secondary">No treatment lines added</p>
                  </div>
                )}
              </section>
            </div>

            <aside className="space-y-5 xl:sticky xl:top-4 xl:self-start">
              <section className="glass-card overflow-hidden p-5">
                <SectionHeader icon={ShieldCheck} eyebrow="Review" title="Pre Auth Claim summary" />
                <div className="mt-5 space-y-3">
                  {[
                    { label: "Claim type", value: formData.claim_type },
                    { label: "Hospital tier", value: hospitalTier },
                    { label: "Diagnosis", value: selectedDiagnosis ? `${selectedDiagnosis.code} - ${selectedDiagnosis.desc}` : "Pending" },
                    {
                      label: "Reference library",
                      value: referenceLoading
                        ? "Loading"
                        : `${referenceData.hospitals.length} hospitals / ${referenceData.treatment_doctors.length} doctors`,
                    },
                    { label: "Requested estimate", value: currency(formData.estimated_total) },
                    { label: "Documents", value: uploadedDocs.length > 0 ? `${uploadedDocs.length} uploaded` : "Pending" },
                  ].map((row) => (
                    <div key={row.label} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-3">
                      <p className="ui-eyebrow text-text-muted">{row.label}</p>
                      <p className="mt-1 text-sm font-semibold text-text-primary">{row.value}</p>
                    </div>
                  ))}
                </div>
              </section>

              {error && (
                <div className="glass-card border-[var(--status-danger)]/20 bg-[var(--status-danger)]/8 p-4">
                  <div className="flex gap-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-danger)]" />
                    <p className="text-sm font-medium text-[var(--status-danger)]">{error}</p>
                  </div>
                </div>
              )}

              {success && (
                <div className="space-y-3">
                  <div className="glass-card border-[var(--status-success)]/20 bg-[var(--status-success)]/8 p-4">
                    <div className="flex gap-3">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-success)]" />
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-[var(--status-success)]">Pre Auth Claim submitted</p>
                        <p className="font-mono text-text-secondary">{success.claim_reference}</p>
                        <p className="font-mono text-text-muted">{success.preauth_reference}</p>
                        <p className="text-text-secondary">{success.preauth_status === "PENDING_HITL" ? "Under review" : success.preauth_status}</p>
                        <button
                          type="button"
                          onClick={() => router.push(`/claims-advance/${success.claim_reference}`)}
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--status-success)]/20 bg-[var(--status-success)]/10 px-3 py-2 text-xs font-semibold text-[var(--status-success)] transition-colors hover:bg-[var(--status-success)]/18"
                        >
                          Open record
                        </button>
                      </div>
                    </div>
                  </div>
                  {/* Pre Auth Claim: live event trail from graph service */}
                  <GraphTrace claimId={success.id} />
                </div>
              )}

              <div className="glass-card p-4">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="ui-button-primary h-11 w-full rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
                >
                  {isProcessingDocs ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing document
                    </>
                  ) : isUploadingDocs ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading documents
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Submit Pre Auth Claim
                    </>
                  )}
                </button>
                {!canSubmit && !isSubmitting && !isUploadingDocs && !isProcessingDocs && (
                  <p className="mt-3 text-xs leading-5 text-text-muted">
                    Complete: {missingRequiredFields.map((field) => REQUIRED_ADVANCE_FIELD_LABELS[field]).join(", ")}
                  </p>
                )}
              </div>
            </aside>
          </form>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <section className="glass-card overflow-hidden p-5">
            <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <SectionHeader icon={ClipboardList} eyebrow="Registry" title="Pre Auth Claim history" />
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--acos-surface)] px-3 py-1.5 text-xs font-semibold text-text-muted">
                {history.length} records
              </span>
            </div>

            {historyLoading ? (
              <div className="flex justify-center py-14">
                <Loader2 className="h-7 w-7 animate-spin text-brand-primary" />
              </div>
            ) : history.length === 0 ? (
              <div className="py-14 text-center">
                <ClipboardList className="mx-auto h-7 w-7 text-text-muted" />
                <p className="mt-3 text-sm font-semibold text-text-muted">No Pre Auth Claims found</p>
              </div>
            ) : (
              <div className="mt-4 grid gap-3">
                {history.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4 transition-colors hover:border-brand-primary/25 hover:bg-[var(--acos-surface-strong)]"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => router.push(`/claims-advance/${claim.claim_reference}`)}
                          className="truncate font-mono text-sm font-semibold text-brand-primary hover:underline text-left"
                        >
                          {claim.claim_reference}
                        </button>
                        <p className="mt-1 truncate font-mono text-xs text-text-muted">{claim.preauth_reference}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--acos-surface)] px-2 py-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(claim.date_created).toLocaleDateString()}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--acos-surface)] px-2 py-1">
                            <MapPin className="h-3 w-3" />
                            INDIA
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-4 sm:flex-col sm:items-end">
                        <span className={cn("rounded-full border px-2.5 py-1 text-[11px] font-bold", statusTone(claim.preauth_status))}>
                          {claim.preauth_status}
                        </span>
                        <p className="font-mono text-sm font-semibold text-text-primary">{currency(claim.estimated_plan_payment)}</p>
                        <button
                          type="button"
                          onClick={() => router.push(`/claims-advance/${claim.claim_reference}`)}
                          className="ui-button-secondary rounded-xl px-3 py-2 text-xs font-semibold"
                        >
                          View detail
                        </button>
                      </div>
                    </div>
                    {/* Pre Auth Claim: event trail for each history record */}
                    <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                      <GraphTrace claimId={claim.id} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
