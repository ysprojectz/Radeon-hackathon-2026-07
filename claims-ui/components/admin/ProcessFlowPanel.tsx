"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { fetchCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";

const MermaidDiagram = dynamic(
  () =>
    import("@/components/shared/MermaidDiagram").then((m) => ({
      default: m.MermaidDiagram,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-40 gap-2 dark:text-slate-500 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading diagram...</span>
      </div>
    ),
  }
);

// NEW: Multi-Agent Architecture Diagram with 8 pipeline stages
const MULTI_AGENT_FLOW_CHART = `flowchart TD
    START([User visits portal]) --> LP

    subgraph AUTH ["TOTP Authentication"]
        LP["Login Page"] --> ENTER_EMAIL["Enter Email"]
        ENTER_EMAIL --> HAS_SETUP{"TOTP\nConfigured?"}
        HAS_SETUP -->|First time| SHOW_QR["Display QR Code\nScan with Authenticator app"]
        SHOW_QR --> ENTER_CODE["Enter 6-digit rolling code"]
        HAS_SETUP -->|Returning user| ENTER_CODE
        ENTER_CODE --> CODE_VALID{"Code valid?"}
        CODE_VALID -->|Wrong code| ENTER_CODE
        CODE_VALID -->|Correct| ISSUE_JWT["JWT httpOnly cookie issued"]
    end

    ISSUE_JWT --> ROLE{"User Role?"}
    ROLE -->|ADMIN| DA["Admin Dashboard"]
    ROLE -->|ADJUSTER| DB["Adjuster Dashboard"]
    ROLE -->|REVIEWER| DR["Reviewer Dashboard"]
    ROLE -->|COMPLIANCE| DC["Compliance Dashboard"]

    subgraph DASH ["Dashboard"]
        DA & DB & DR & DC --> KPI["KPI Cards\nTotal - Pending - Settled - Rejected - Review Flags"]
        KPI --> CLAIMS_TABLE["Recent Claims Table"]
    end

    CLAIMS_TABLE --> ACTION{"User Action?"}
    ACTION -->|New Claim| WIZ_START
    ACTION -->|View Claim| CLAIM_DETAIL
    ACTION -->|Admin Panel| ADMIN_CONFIG
    ACTION -->|View Agents| AGENT_DASHBOARD

    subgraph WIZARD ["Claim Submission Wizard — 5 Steps"]
        WIZ_START["Step 1 — Select Policy\nChoose coverage - Market region - Policy number"]
        UPLOAD_PDF["Step 2 — Upload PDF\nDrag-drop or browse - Max 20 MB - PDF only"]
        DOC_GATE{"Document\nValidation Gate\n5-signal smoke test"}
        INVALID_DOC["Not a Claim Document\nUser message shown - Ask to re-upload"]
        OCR_RUN["OCR Extraction\npdfplumber - Tesseract fallback\nPer-field confidence scoring\nMarket auto-detection"]
        REVIEW["Step 3 — Review OCR Fields\nEdit low-confidence fields\nConfirm 11 required fields"]
        ADJ_SUBMIT["Step 4 — Submit for Adjudication"]
        RESULTS["Step 5 — View Results\nClaim reference - Settlement breakdown"]

        WIZ_START --> UPLOAD_PDF
        UPLOAD_PDF --> DOC_GATE
        DOC_GATE -->|Fail — less than 3 of 5 signals| INVALID_DOC
        INVALID_DOC --> UPLOAD_PDF
        DOC_GATE -->|Pass — 3 or more of 5 signals| OCR_RUN
        OCR_RUN --> REVIEW
        REVIEW --> ADJ_SUBMIT
    end

    ADJ_SUBMIT --> PH1

    %% MULTI-AGENT PIPELINE - 8 Stages
    subgraph PIPELINE ["Multi-Agent Adjudication Pipeline — 8 Stages"]
        %% Stage 1: Validation
        PH1["Stage 1 - Validation Agent\n5-Signal Document Gate:\nSignal 1: Claim keywords\nSignal 2: Financial data\nSignal 3: Member or Patient identity\nSignal 4: Provider information\nSignal 5: Dates\nRequires at least 3 to pass"]
        
        %% Stage 2: OCR
        PH2["Stage 2 - OCR Agent\nPDF/Image Text Extraction\nField extraction with confidence scoring\nMarket auto-detection"]
        
        %% Stage 3: Rules Engine
        PH3["Stage 3 - Rules Engine Agent\nIndia: Room rent cap - GIPSA rate - AYUSH\nDeterministic rule evaluation\n7 predefined rules"]
        
        %% Stage 4: AI
        PH4["Stage 4 - Intelligence AI Agent\nRegulatory and company policy reasoning\nPolicy citation extraction\nReasoning with guardrails"]
        
        %% Stage 5: Dual Validation
        PH5["Stage 5 - Dual-Validation Agent\nCross-model validation\nCompare Rules Engine vs AI results\nCalculate disagreement score\nFlag conflicts for HITL"]
        
        %% Stage 6: Settlement
        PH6["Stage 6 - Settlement Agent\nIndia: Proportionate - 80 to 40 percent\nGST calculation\nCopay, Deductible, Plan share"]

        %% Stage 7: Calculation
        PH7["Stage 7 - Calculation Agent\nCurrency conversion\nTax application - India 18 percent GST\nAccumulator management\nFinal amount calculation"]
        
        %% Stage 8: Audit
        PH8["Stage 8 - Audit Agent\nSHA-256 hash chain\nImmutable audit trail\nComplete event logging\nChain integrity verification"]
        
        %% Connections
        PH1 --> PH2 --> PH3 --> PH4 --> PH5 --> PH6 --> PH7 --> PH8
    end

    %% Confidence Scoring and Routing
    subgraph ROUTING ["Confidence Scoring & Routing"]
        CONFIDENCE["Calculate Confidence Score\nBase: 100\nDeductions:\n-15 for denial\n-10 for high value above 50K\n-20 for very high value above 100K\n-20 for low pre-auth\n-25 for assistant flags\n-30 for manual review recommendation\n-35 to -5 for disagreement scaled"]
        
        ROUTE{"HITL\nRoute?"}
        
        AUTO_ROUTE{"Confidence at least 95 percent\nAND No violations\nAND Amount within regional limit?"}
        REGIONAL_LIMITS["Regional Auto-Limits:\nIndia: 500,000"]
        
        CONFIDENCE --> ROUTE
        ROUTE --> AUTO_ROUTE
        AUTO_ROUTE -->|Yes| SETTLED
        AUTO_ROUTE -->|No| HITL_FLAG
        AUTO_ROUTE --> REGIONAL_LIMITS
    end

    subgraph HITL ["Human-in-the-Loop Review"]
        HITL_FLAG["HITL PENDING\nAdded to Reviewer Queue - SLA timer started"]
        REVIEW_INS["Reviewer inspects:\nOCR fields - Line items - AI reasoning\nViolations - Policy citations"]
        REVIEW_DEC{"Reviewer Decision?"}
        
        %% Priority System (4h - 48h SLA)
        HITL_PRIORITY["Priority Assignment:\nP1 4h: Confidence below 50 OR Amount above 100K OR Regulatory violation\nP2 8h: Confidence below 75 OR Amount above 50K OR Violations\nP3 12h: Default\nP4 24h: Confidence at least 90 AND Amount below 10K\nP5 48h: Background processing"]
        
        HITL_FLAG --> HITL_PRIORITY
        HITL_PRIORITY --> REVIEW_INS
        REVIEW_INS --> REVIEW_DEC
        REVIEW_DEC -->|Approve| SETTLED
        REVIEW_DEC -->|Reject| REJECTED
        REVIEW_DEC -->|Escalate| ESCALATE["Escalate to Senior Reviewer"]
    end

    SETTLED["SETTLED\nFinal amount - Copay breakdown - VAT applied - Claim reference"]
    REJECTED["REJECTED\nReason cited - Regulatory reference - Audit trail logged"]

    SETTLED --> RESULTS
    REJECTED --> RESULTS
    RESULTS --> CLAIM_DETAIL

    subgraph DETAIL ["Claim Detail and Post-Settlement"]
        CLAIM_DETAIL["Full Adjudication Report\nLine items - Settlement breakdown\nPolicy citations - AI citations\nAudit log - Agent processing results"]
        APPEAL{"File Appeal?"}
        SESSION_END([Session complete])
        CLAIM_DETAIL --> APPEAL
        APPEAL -->|No| SESSION_END
        APPEAL -->|Yes| APPEAL_RESUBMIT["Appeal submitted\nRe-enters pipeline at Stage 1"]
    end

    APPEAL_RESUBMIT --> ADJ_SUBMIT

    subgraph ADMIN ["Admin Panel — ADMIN role only"]
        ADMIN_CONFIG["System Config\nConfidence thresholds - AI Agent controls\nProvider fallback - Tax rates\nAgent Orchestrator Controls"]
        AGENT_DASHBOARD["Agent Dashboard\nMonitor all 9 agent types\nHealth status - Metrics - Queue\nStart/Stop agents - View logs"]
        ADMIN_POLICIES["Master Policy Library\nUpload docs - AI Agent clause extraction\nNational and Company policies"]
        ADMIN_CLAIMS["Claims Management\nAll claims - Advanced filters - Export"]
        ADMIN_FLOW["Process Flow\nSystem architecture diagram"]
        ADMIN_CONFIG --- AGENT_DASHBOARD --- ADMIN_POLICIES --- ADMIN_CLAIMS --- ADMIN_FLOW
    end

    classDef stage fill:#0f172a,stroke:#1e293b,stroke-width:2px,color:#e2e8f0
    class PH1,PH2,PH3,PH4,PH5,PH6,PH7,PH8,CONFIDENCE,ROUTE,AUTO_ROUTE,REGIONAL_LIMITS,HITL_PRIORITY stage
    
    classDef highlight fill:#3b82f6,stroke:#1d4ed8,stroke-width:2px,color:#fff
    class PH1,PH2,PH3,PH4,PH5,PH6,PH7,PH8 highlight
`;

// Original flow chart for reference
const FLOW_CHART = `flowchart TD
    START([User visits portal]) --> LP

    subgraph AUTH ["TOTP Authentication"]
        LP["Login Page"] --> ENTER_EMAIL["Enter Email"]
        ENTER_EMAIL --> HAS_SETUP{"TOTP\nConfigured?"}
        HAS_SETUP -->|First time| SHOW_QR["Display QR Code\nScan with Authenticator app"]
        SHOW_QR --> ENTER_CODE["Enter 6-digit rolling code"]
        HAS_SETUP -->|Returning user| ENTER_CODE
        ENTER_CODE --> CODE_VALID{"Code valid?"}
        CODE_VALID -->|Wrong code| ENTER_CODE
        CODE_VALID -->|Correct| ISSUE_JWT["JWT httpOnly cookie issued"]
    end

    ISSUE_JWT --> ROLE{"User Role?"}
    ROLE -->|ADMIN| DA["Admin Dashboard"]
    ROLE -->|ADJUSTER| DB["Adjuster Dashboard"]
    ROLE -->|REVIEWER| DR["Reviewer Dashboard"]
    ROLE -->|COMPLIANCE| DC["Compliance Dashboard"]

    subgraph DASH ["Dashboard"]
        DA & DB & DR & DC --> KPI["KPI Cards\nTotal - Pending - Settled - Rejected - Review Flags"]
        KPI --> CLAIMS_TABLE["Recent Claims Table"]
    end

    CLAIMS_TABLE --> ACTION{"User Action?"}
    ACTION -->|New Claim| WIZ_START
    ACTION -->|View Claim| CLAIM_DETAIL
    ACTION -->|Admin Panel| ADMIN_CONFIG

    subgraph WIZARD ["Claim Submission Wizard — 5 Steps"]
        WIZ_START["Step 1 — Select Policy\nChoose coverage - Market region - Policy number"]
        UPLOAD_PDF["Step 2 — Upload PDF\nDrag-drop or browse - Max 20 MB - PDF only"]
        DOC_GATE{"Document\nValidation Gate\n5-signal smoke test"}
        INVALID_DOC["Not a Claim Document\nUser message shown - Ask to re-upload"]
        OCR_RUN["OCR Extraction\npdfplumber - Tesseract fallback\nPer-field confidence scoring\nMarket auto-detection"]
        REVIEW["Step 3 — Review OCR Fields\nEdit low-confidence fields\nConfirm 11 required fields"]
        ADJ_SUBMIT["Step 4 — Submit for Adjudication"]
        RESULTS["Step 5 — View Results\nClaim reference - Settlement breakdown"]

        WIZ_START --> UPLOAD_PDF
        UPLOAD_PDF --> DOC_GATE
        DOC_GATE -->|Fail — less than 3 of 5 signals| INVALID_DOC
        INVALID_DOC --> UPLOAD_PDF
        DOC_GATE -->|Pass — 3 or more of 5 signals| OCR_RUN
        OCR_RUN --> REVIEW
        REVIEW --> ADJ_SUBMIT
    end

    ADJ_SUBMIT --> PH1

    subgraph PIPELINE ["Adjudication Pipeline — 6 Phases"]
        PH1["Phase 1 — Identity Validation\nLook up Member - Provider - Policy\nFail-fast if unknown"]
        PH2["Phase 2 — Rules Engine\nIndia: Room rent cap - GIPSA rate - AYUSH - Domiciliary"]
        PH3["Phase 3 — Intelligence AI Agent\nTier 1 regulatory + Tier 2 company clause analysis"]
        PH3B["Phase 3b — Dual-Agent Validation\nRules Engine vs AI Agent cross-check\nDisagreement triggers manual review"]
        PH4["Phase 4 - Settlement Calculator\nIndia 18 percent GST\nCopay - Deductible - Plan share vs Member share"]
        PH5["Phase 5 — Confidence Scoring\nBase 100 - Deductions: denials - high value\nlow pre-auth - AI conflict - HITL recommendations"]
        ROUTE{"HITL\nRoute?"}

        PH1 --> PH2 --> PH3 --> PH3B --> PH4 --> PH5 --> ROUTE
    end

    ROUTE -->|Confidence 95 percent or above\nNo violations - No flags| SETTLED
    ROUTE -->|Regulatory violation\nOR Confidence 80 to 95 percent\nOR AI-flagged items\nOR Claim above 50k INR\nOR Claim above 100k INR| HITL_FLAG

    subgraph HITL ["Human-in-the-Loop Review"]
        HITL_FLAG["HITL PENDING\nAdded to Reviewer Queue - SLA timer started"]
        REVIEW_INS["Reviewer inspects:\nOCR fields - Line items - AI reasoning - Violations"]
        REVIEW_DEC{"Reviewer Decision?"}
        HITL_FLAG --> REVIEW_INS --> REVIEW_DEC
        REVIEW_DEC -->|Approve| SETTLED
        REVIEW_DEC -->|Reject| REJECTED
    end

    SETTLED["SETTLED\nFinal amount - Copay breakdown - VAT applied - Claim reference"]
    REJECTED["REJECTED\nReason cited - Regulatory reference - Audit trail logged"]

    SETTLED --> RESULTS
    REJECTED --> RESULTS
    RESULTS --> CLAIM_DETAIL

    subgraph DETAIL ["Claim Detail and Post-Settlement"]
        CLAIM_DETAIL["Full Adjudication Report\nLine items - Settlement breakdown - Policy citations - Audit log"]
        APPEAL{"File Appeal?"}
        SESSION_END([Session complete])
        CLAIM_DETAIL --> APPEAL
        APPEAL -->|No| SESSION_END
        APPEAL -->|Yes| APPEAL_RESUBMIT["Appeal submitted\nRe-enters pipeline at Phase 1"]
    end

    APPEAL_RESUBMIT --> ADJ_SUBMIT

    subgraph ADMIN ["Admin Panel — ADMIN role only"]
        ADMIN_CONFIG["System Config\nConfidence thresholds - AI Agent controls\nProvider fallback - Tax rates"]
        ADMIN_POLICIES["Master Policy Library\nUpload docs - AI Agent clause extraction\nNational and Company policies"]
        ADMIN_CLAIMS["Claims Management\nAll claims - Advanced filters - Export"]
        ADMIN_FLOW["Process Flow\nSystem architecture diagram"]
        ADMIN_CONFIG --- ADMIN_POLICIES --- ADMIN_CLAIMS --- ADMIN_FLOW
    end`;

export default function ProcessFlowPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [showMultiAgent, setShowMultiAgent] = useState(true);

  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  if (!authChecked) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin dark:text-slate-500 text-slate-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Process Flow"
      />

      {/* Toggle for diagram view */}
      <div className="flex gap-2 p-6">
        <Button
          variant={showMultiAgent ? "default" : "outline"}
          onClick={() => setShowMultiAgent(true)}
        >
          Multi-Agent Pipeline (New)
        </Button>
        <Button
          variant={!showMultiAgent ? "default" : "outline"}
          onClick={() => setShowMultiAgent(false)}
        >
          Original Pipeline
        </Button>
      </div>

      {/* Diagram */}
      <div className="glass-card rounded-xl p-6">
        <MermaidDiagram chart={showMultiAgent ? MULTI_AGENT_FLOW_CHART : FLOW_CHART} />
      </div>

      {/* Legend */}
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4">Multi-Agent Journey (8 Stages)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          {[
            { stage: "1 - Validation", desc: "5-signal document validation gate" },
            { stage: "2 - OCR", desc: "PDF/Image text extraction with confidence scoring" },
            { stage: "3 - Rules Engine", desc: "Deterministic rules evaluation (7 predefined rules)" },
            { stage: "4 - AI", desc: "AI intelligence analysis with policy citation extraction" },
            { stage: "5 - Dual Validation", desc: "Cross-model validation (Rules vs AI)" },
            { stage: "6 - Settlement", desc: "Settlement calculation with regional rules" },
            { stage: "7 - Calculation", desc: "Financial calculations (tax, currency, accumulators)" },
            { stage: "8 - Audit", desc: "SHA-256 hash chain for immutable audit trail" },
          ].map((item, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</span>
              <div>
                <div className="font-medium">{item.stage}</div>
                <div className="text-muted-foreground text-xs">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
