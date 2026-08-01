"use client";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Pencil, CheckCircle, AlertTriangle, AlertCircle, 
  FileText, Database, Brain, Sparkles,
  Search, Info, ChevronRight, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { OCRUploadResult } from "@/lib/types";

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function isFutureDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d > new Date();
}

interface Step3Props {
  ocrResult: OCRUploadResult;
  onNext: (fields: Record<string, string>) => void;
  onBack: () => void;
  policyMarket?: string | null;
}

const DISPLAY_FIELDS: { key: string; label: string; required?: boolean; category: string }[] = [
  { key: "member_number", label: "Member Number", required: true, category: "Patient" },
  { key: "patient_name", label: "Patient Name", category: "Patient" },
  { key: "patient_dob", label: "Date of Birth", required: true, category: "Patient" },
  { key: "service_date", label: "Service Date", required: true, category: "Claims" },
  { key: "total_billed", label: "Total Billed", required: true, category: "Claims" },
  { key: "currency", label: "Currency", category: "Claims" },
  { key: "provider_code", label: "Provider Code", category: "Provider" },
  { key: "provider_name", label: "Provider Name", category: "Provider" },
  { key: "market_region", label: "Market Region", category: "Intelligence" },
  { key: "claim_type", label: "Claim Type", category: "Intelligence" },
  { key: "primary_diagnosis_code", label: "Diagnosis Code", required: true, category: "Intelligence" },
  { key: "policy_number", label: "Policy Number", category: "India Policy" },
  { key: "certificate_number", label: "Certificate Number", category: "India Policy" },
  { key: "tpa_id", label: "TPA ID", category: "India Policy" },
  { key: "primary_insured_name", label: "Primary Insured", category: "India Insured" },
  { key: "hospitalized_person_name", label: "Hospitalized Person", category: "India Patient" },
  { key: "hospitalisation_due_to", label: "Hospitalisation Due To", category: "India Hospitalisation" },
  { key: "room_category", label: "Room Category", category: "India Hospitalisation" },
  { key: "total_claim_amount", label: "Total Claim Amount", category: "India Claim" },
  { key: "pre_hospitalisation_expenses", label: "Pre-Hospitalisation", category: "India Claim" },
  { key: "hospitalisation_expenses", label: "Hospitalisation Expenses", category: "India Claim" },
  { key: "post_hospitalisation_expenses", label: "Post-Hospitalisation", category: "India Claim" },
  { key: "ambulance_charges", label: "Ambulance Charges", category: "India Claim" },
  { key: "pan_number", label: "PAN", category: "India Banking" },
  { key: "account_number", label: "Account Number", category: "India Banking" },
  { key: "bank_name", label: "Bank Name", category: "India Banking" },
  { key: "ifsc_code", label: "IFSC Code", category: "India Banking" },
];

export function Step3ReviewOCR({ ocrResult, onNext, onBack, policyMarket }: Step3Props) {
  const fields = ocrResult.extracted_fields ?? {};
  const confidences = ocrResult.field_confidences ?? {};
  const overall = ocrResult.overall_confidence ?? 0;

  const [editValues, setEditValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    DISPLAY_FIELDS.forEach(({ key }) => {
      const val = fields[key];
      initial[key] = typeof val === "string" ? val : "";
    });
    return initial;
  });
  const [editing, setEditing] = useState<string | null>(null);

  const today = useMemo(() => todayString(), []);

  // Validation
  const serviceDateValue = editValues["service_date"] ?? "";
  const serviceDateFuture = isFutureDate(serviceDateValue);

  const detectedMarket = ((ocrResult.extracted_fields?.market_region ?? "")).toUpperCase();
  const marketMismatch = policyMarket && detectedMarket && policyMarket.toUpperCase() !== detectedMarket;

  const requiredFields = DISPLAY_FIELDS.filter((f) => f.required);
  const missingRequired = requiredFields.filter(({ key }) => !editValues[key]);
  const canProceed = missingRequired.length === 0 && !serviceDateFuture;

  const requiredKeys = new Set(requiredFields.map((f) => f.key));

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-brand-primary/20 rounded-lg border border-brand-primary/30">
              <Brain className="w-4 h-4 text-brand-primary" />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-primary/80">Intelligence Review</h3>
          </div>
          <h2 className="text-2xl font-bold text-text-primary">Verify Neural Extractions</h2>
        </div>

        <div className="flex items-center gap-6 p-4 rounded-2xl bg-[var(--acos-surface)] border border-[var(--border-subtle)]">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-text-muted">
              <span>Overall Confidence</span>
              <span className={cn(
                "text-xs transition-colors",
                overall >= 0.85 ? "text-[var(--status-success)]" : overall >= 0.7 ? "text-[var(--status-warning)]" : "text-[var(--status-danger)]"
              )}>
                {(overall * 100).toFixed(0)}%
              </span>
            </div>
            <div className="h-1.5 w-48 bg-[var(--acos-surface)] rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${overall * 100}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={cn(
                  "h-full rounded-full",
                  overall >= 0.85 ? "bg-[var(--status-success)]" : overall >= 0.7 ? "bg-[var(--status-warning)]" : "bg-[var(--status-danger)]"
                )}
              />
            </div>
          </div>
        </div>
      </div>

      {marketMismatch && (
        <Alert className="border-[var(--status-warning)]/40 bg-[var(--status-warning)]/5 backdrop-blur-md">
          <AlertCircle className="h-4 w-4 text-[var(--status-warning)]" />
          <AlertDescription className="text-[var(--status-warning)]/70 text-xs">
            <span className="font-bold text-[var(--status-warning)] mr-2">PROTOCOL MISMATCH</span>
            Policy market <span className="text-text-primary font-bold">{policyMarket}</span> does not align with detected document market <span className="text-text-primary font-bold">{detectedMarket}</span>.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left: Document Vault */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-3.5 h-3.5 text-text-muted" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-text-muted">Document Vault</h4>
          </div>
          
          <div className="aspect-[3/4] rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] flex flex-col items-center justify-center p-8 text-center relative group overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-b from-brand-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
            
            <div className="p-4 rounded-full bg-[var(--acos-surface)] border border-[var(--border-subtle)] mb-4 group-hover:scale-110 transition-transform duration-500">
              <FileText className="w-10 h-10 text-text-muted group-hover:text-brand-primary/40 transition-colors" />
            </div>
            <h5 className="text-sm font-bold text-text-muted">Secure Document Preview</h5>
            <p className="text-[10px] text-text-muted mt-2 max-w-[200px]">Interactive PDF rendering is restricted in review mode. Cross-reference using original source if needed.</p>
            
            <Button variant="outline" size="sm" className="mt-6 border-[var(--border-subtle)] bg-[var(--acos-surface)] text-[10px] uppercase font-black tracking-widest h-8 px-4 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
              <Eye className="w-3.5 h-3.5 mr-2" /> Pop-out Preview
            </Button>

            {/* Neural scan lines effect */}
            <div className="absolute inset-x-0 top-0 h-px bg-brand-primary/20 animate-scan-y pointer-events-none" />
          </div>

          <div className="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] space-y-3">
             <div className="flex items-center gap-2">
               <Sparkles className="w-3 h-3 text-brand-primary/60" />
               <span className="text-[9px] font-black uppercase tracking-widest text-text-muted">Engine Insights</span>
             </div>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[8px] font-bold text-text-muted uppercase tracking-tighter mb-1">Document Provider</p>
                  <p className="text-[10px] font-mono text-brand-primary/60">OCR + Intelligence AI Agent</p>
                </div>
                <div>
                  <p className="text-[8px] font-bold text-text-muted uppercase tracking-tighter mb-1">Extraction Latency</p>
                  <p className="text-[10px] font-mono text-brand-primary/60">1.4s (Intelligence AI Agent)</p>
                </div>
             </div>
          </div>
        </div>

        {/* Right: Review Center */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-3.5 h-3.5 text-text-muted" />
            <h4 className="text-[10px] font-black uppercase tracking-widest text-text-muted">Intelligence Review Center</h4>
          </div>

          <div className="glass-card rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] overflow-hidden">
            <div className="max-h-[600px] overflow-y-auto custom-scrollbar divide-y divide-white/[0.04]">
              {DISPLAY_FIELDS.map(({ key, label, category, required }) => {
                const conf = confidences[key] ?? null;
                const isLow = conf !== null && conf < 0.75;
                const isEditing = editing === key;
                const isMissingRequired = requiredKeys.has(key) && !editValues[key];
                
                return (
                  <motion.div 
                    key={key}
                    layout
                    className={cn(
                      "group flex flex-col md:flex-row md:items-center gap-4 px-6 py-4 transition-colors",
                      isEditing ? "bg-brand-primary/[0.03]" : "hover:bg-[var(--acos-surface)]",
                      isMissingRequired ? "bg-[var(--status-danger)]/[0.03]" : ""
                    )}
                  >
                    <div className="w-36 shrink-0 space-y-1">
                      <p className="text-[8px] font-black uppercase tracking-widest text-text-muted">{category}</p>
                      <p className="text-[11px] font-bold text-text-primary group-hover:text-text-primary transition-colors">
                        {label}
                        {required && <span className="text-[var(--status-danger)]/60 ml-1">*</span>}
                      </p>
                    </div>

                    <div className="flex-1 relative">
                      <AnimatePresence mode="wait">
                        {isEditing ? (
                          <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }}>
                            <Input
                              autoFocus
                              type={key.includes("date") || key.includes("dob") ? "date" : "text"}
                              max={key.includes("date") || key.includes("dob") ? today : undefined}
                              value={editValues[key]}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, [key]: e.target.value }))}
                              onBlur={() => setEditing(null)}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(null); }}
                              className="h-9 bg-[var(--bg-card-muted)] border-brand-primary/40 text-sm text-brand-primary ring-1 ring-brand-primary/20"
                            />
                          </motion.div>
                        ) : (
                          <div 
                            onClick={() => setEditing(key)}
                            className={cn(
                              "h-9 flex items-center px-3 rounded-lg border transition-all cursor-pointer",
                              isMissingRequired ? "border-[var(--status-danger)]/40 bg-[var(--status-danger)]/5" : "border-transparent bg-[var(--acos-surface)] group-hover:border-[var(--border-subtle)] group-hover:bg-[var(--acos-surface)]"
                            )}
                          >
                            <span className={cn(
                              "text-sm truncate",
                              editValues[key] ? "text-text-primary" : "text-text-muted italic"
                            )}>
                              {editValues[key] || "No data extracted"}
                            </span>
                            <Pencil className="w-3 h-3 ml-auto text-text-muted group-hover:text-brand-primary/40" />
                          </div>
                        )}
                      </AnimatePresence>
                      
                      {isMissingRequired && !isEditing && (
                        <p className="absolute -bottom-4 left-0 text-[9px] font-bold text-[var(--status-danger)]/80 uppercase tracking-tighter animate-pulse">Required field missing</p>
                      )}
                    </div>

                    <div className="flex items-center gap-3 min-w-[80px] justify-end">
                      {conf !== null && !isEditing && (
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn(
                            "text-[10px] font-mono",
                            conf >= 0.85 ? "text-[var(--status-success)]/60" : conf >= 0.7 ? "text-[var(--status-warning)]/60" : "text-[var(--status-danger)]/60"
                          )}>
                            {(conf * 100).toFixed(0)}%
                          </span>
                          <div className="w-12 h-1 bg-[var(--acos-surface)] rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full rounded-full",
                                conf >= 0.85 ? "bg-[var(--status-success)]/60" : conf >= 0.7 ? "bg-[var(--status-warning)]/60" : "bg-[var(--status-danger)]/60"
                              )}
                              style={{ width: `${conf * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className={cn(
                        "p-1.5 rounded-full",
                        isMissingRequired ? "bg-[var(--status-danger)]/20 text-[var(--status-danger)]" : isLow ? "bg-[var(--status-warning)]/20 text-[var(--status-warning)]" : editValues[key] ? "bg-[var(--status-success)]/20 text-[var(--status-success)]" : "text-text-muted"
                      )}>
                        {isMissingRequired ? <AlertCircle className="w-3.5 h-3.5" /> : isLow ? <AlertTriangle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between p-4 rounded-2xl bg-brand-primary/[0.02] border border-brand-primary/10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-brand-primary/10 rounded-lg">
                <Info className="w-4 h-4 text-brand-primary/60" />
              </div>
              <p className="text-[10px] text-text-muted leading-relaxed max-w-sm">
                Manual corrections will improve future extraction accuracy via <span className="text-brand-primary/40 font-bold">Feedback Loop reinforcement</span>.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="ghost" onClick={onBack} className="text-[10px] font-black uppercase tracking-widest h-10">
                Cancel
              </Button>
              <Button
                onClick={() => onNext(editValues)}
                disabled={!canProceed}
                className="h-10 px-6 text-[10px] font-black uppercase tracking-[0.2em]"
              >
                Execute Adjudication <ChevronRight className="w-3.5 h-3.5 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      {/* ── Visual Styles Helper ── */}
      <style jsx global>{`
        @keyframes scan-y {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
        .animate-scan-y {
          animation: scan-y 4s linear infinite;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.02);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(6, 182, 212, 0.3);
        }
      `}</style>
    </div>
  );
}
