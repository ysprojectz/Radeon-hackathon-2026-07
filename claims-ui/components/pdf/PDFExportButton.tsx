"use client";
// NOTE: This component is loaded via next/dynamic with ssr:false in the page.
// @react-pdf/renderer must NOT be imported server-side.
import { PDFDownloadLink } from "@react-pdf/renderer";
import { FinancePDFDocument } from "./FinancePDFDocument";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import type { ClaimResponse, SettlementResponse, AuditTrailResponse } from "@/lib/types";

interface PDFExportButtonProps {
  claim: ClaimResponse;
  settlement: SettlementResponse;
  audit: AuditTrailResponse;
}

export function PDFExportButton({ claim, settlement, audit }: PDFExportButtonProps) {
  const filename = `claims-report-${claim.claim_reference}-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;

  // Don't render until all data is loaded — avoids @react-pdf crashes on partial data
  if (!claim || !settlement || !audit) {
    return (
      <Button variant="outline" size="sm" disabled className="gap-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Generating PDF…
      </Button>
    );
  }

  return (
    <PDFDownloadLink
      document={
        <FinancePDFDocument claim={claim} settlement={settlement} audit={audit} />
      }
      fileName={filename}
    >
      {({ loading }) =>
        loading ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generating PDF…
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Export Finance PDF
          </Button>
        )
      }
    </PDFDownloadLink>
  );
}
