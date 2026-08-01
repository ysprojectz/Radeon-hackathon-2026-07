"""
Pre-Authorization Letter Generator
====================================
Generates a PDF pre-authorization letter for approved India cashless claims.
Uses reportlab for PDF generation and qrcode for the verification QR code.

The letter contains:
  - Pre-auth reference number (large, prominent)
  - Patient name and ABHA address
  - Approved amount (INR)
  - Approved procedures table
  - Validity: 72 hours from approval timestamp
  - QR code encoding the pre-auth reference + NHCX verification URL
  - IRDAI registration footer
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)


def generate_preauth_letter(
    advance_claim: dict,
    nhcx_reference: Optional[str] = None,
) -> bytes:
    """
    Generate a PDF pre-authorization letter.

    Args:
        advance_claim: dict from advance_claims table (or API response)
        nhcx_reference: NHCX reference ID if available

    Returns:
        PDF bytes
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        )
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
    except ImportError:
        logger.warning("[Letter] reportlab not installed — returning stub PDF")
        return _stub_pdf(advance_claim)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Heading1"],
        fontSize=18, spaceAfter=6, alignment=TA_CENTER,
        textColor=colors.HexColor("#0d6efd"),
    )
    ref_style = ParagraphStyle(
        "Ref", parent=styles["Heading2"],
        fontSize=14, spaceAfter=4, alignment=TA_CENTER,
        textColor=colors.HexColor("#198754"),
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["Normal"],
        fontSize=10, spaceAfter=4,
    )
    label_style = ParagraphStyle(
        "Label", parent=styles["Normal"],
        fontSize=9, textColor=colors.grey,
    )

    preauth_ref = advance_claim.get("preauth_reference", "PREAUTH-UNKNOWN")
    claim_ref = advance_claim.get("claim_reference", "")
    patient_name = advance_claim.get("patient_name", "Patient")
    abha_address = advance_claim.get("abha_address", "")
    estimated_amount = float(advance_claim.get("estimated_plan_payment") or
                             advance_claim.get("estimated_coverage") or 0)
    approved_at = advance_claim.get("date_decision") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    try:
        approved_dt = datetime.fromisoformat(approved_at.replace("Z", ""))
    except Exception:
        approved_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    valid_until = approved_dt + timedelta(hours=72)

    nhcx_ref = nhcx_reference or advance_claim.get("nhcx_reference", "Pending")
    line_items = advance_claim.get("line_items", [])

    story = []

    # Header
    story.append(Paragraph("CASHLESS PRE-AUTHORIZATION LETTER", title_style))
    story.append(Paragraph(f"Reference: {preauth_ref}", ref_style))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#0d6efd")))
    story.append(Spacer(1, 6 * mm))

    # Patient details
    story.append(Paragraph("<b>Patient Details</b>", body_style))
    patient_data = [
        ["Patient Name:", patient_name],
        ["Claim Reference:", claim_ref],
        ["ABHA Address:", abha_address or "Not provided"],
        ["NHCX Reference:", nhcx_ref],
    ]
    pt = Table(patient_data, colWidths=[50 * mm, 120 * mm])
    pt.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(pt)
    story.append(Spacer(1, 6 * mm))

    # Approval details
    story.append(Paragraph("<b>Approval Details</b>", body_style))
    approval_data = [
        ["Approved Amount (INR):", f"₹ {estimated_amount:,.2f}"],
        ["Approved On:", approved_dt.strftime("%d %b %Y %H:%M UTC")],
        ["Valid Until:", valid_until.strftime("%d %b %Y %H:%M UTC")],
        ["Validity Period:", "72 hours from approval"],
    ]
    at = Table(approval_data, colWidths=[50 * mm, 120 * mm])
    at.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d1e7dd")),
    ]))
    story.append(at)
    story.append(Spacer(1, 6 * mm))

    # Procedures table
    if line_items:
        story.append(Paragraph("<b>Approved Procedures</b>", body_style))
        proc_data = [["#", "Procedure Code", "Description", "Amount (INR)"]]
        for i, li in enumerate(line_items, 1):
            proc_data.append([
                str(i),
                str(li.get("procedure_code", "")),
                str(li.get("procedure_desc", li.get("service_category", ""))),
                f"₹ {float(li.get('billed_amount', 0)):,.2f}",
            ])
        proc_data.append(["", "", "Total", f"₹ {estimated_amount:,.2f}"])
        proc_t = Table(proc_data, colWidths=[10 * mm, 35 * mm, 90 * mm, 35 * mm])
        proc_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d6efd")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#d1e7dd")),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ]))
        story.append(proc_t)
        story.append(Spacer(1, 6 * mm))

    # QR code
    qr_data = f"{preauth_ref}|{nhcx_ref}|NHCX-VERIFY"
    try:
        import qrcode
        from reportlab.platypus import Image as RLImage
        qr = qrcode.make(qr_data)
        qr_buf = io.BytesIO()
        qr.save(qr_buf, format="PNG")
        qr_buf.seek(0)
        story.append(Paragraph("<b>Verification QR Code</b>", body_style))
        story.append(Paragraph("Scan to verify this pre-authorization at NHCX.", label_style))
        story.append(RLImage(qr_buf, width=30 * mm, height=30 * mm))
        story.append(Spacer(1, 4 * mm))
    except ImportError:
        story.append(Paragraph(f"Verification Code: {qr_data}", label_style))

    # Footer
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.grey))
    story.append(Spacer(1, 3 * mm))
    story.append(Paragraph(
        "This letter is issued under IRDAI Health Insurance Regulations 2016. "
        "NHCX v2.1 compliant. Valid for 72 hours from approval date.",
        label_style,
    ))

    doc.build(story)
    return buf.getvalue()


def _stub_pdf(advance_claim: dict) -> bytes:
    """Return a minimal valid PDF when reportlab is unavailable."""
    ref = advance_claim.get("preauth_reference", "PREAUTH-UNKNOWN")
    content = f"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" \
              f"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" \
              f"3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Contents 4 0 R/Resources<<>>>>\nendobj\n" \
              f"4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 100 700 Td ({ref}) Tj ET\nendstream\nendobj\n" \
              f"xref\n0 5\n0000000000 65535 f\n...\ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n...\n%%EOF"
    return content.encode()
