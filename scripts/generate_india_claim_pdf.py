"""
Generate a realistic India IRDAI-style cashless hospitalisation claim form PDF,
matching the exact field labels services/ocr_service/app/ocr_engine.py's
regex-based extractors look for (PATTERNS_COMMON, PATTERNS_INDIA, and the
line-item table extractor in _extract_line_items). All personal details are
fictional / synthetic test data.

Scenario: 5-day inpatient stay for kidney-stone (renal calculus) treatment,
Deluxe AC room, Chennai hospital, matching DEMO_SCRIPT.md's OCR-intake
segment. Note (2026-08-03): the room-rent line item is a single lump sum
(45,000 for 5 days) — the rules engine's proportionate room-rent-cap
deduction needs a distinct per-day rate, which OCR-only extraction from a
lump-sum line doesn't populate, so this specific claim settles in full
rather than triggering a visible proportionate deduction. The line item
IS correctly extracted and categorized as ROOM_RENT; only the day-rate
math doesn't fire from this document alone.
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable,
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
import os

OUTPUT_PATH = os.path.join(
    os.path.dirname(__file__), "..", "testing_samples", "upload_test_pdfs",
    "04_India_inpatient_room_rent_cap.pdf",
)

STAR_BLUE = colors.HexColor("#1B3A6B")
STAR_RED = colors.HexColor("#C8102E")
LIGHT_BLUE = colors.HexColor("#EEF2F8")
LIGHT_GREY = colors.HexColor("#F5F5F5")
MID_GREY = colors.HexColor("#CCCCCC")
DARK_GREY = colors.HexColor("#333333")
WHITE = colors.white

W, H = A4


def draw_header_footer(canvas_obj, doc):
    canvas_obj.saveState()
    canvas_obj.setFillColor(STAR_BLUE)
    canvas_obj.rect(0, H - 58, W, 58, fill=1, stroke=0)
    canvas_obj.setFillColor(WHITE)
    canvas_obj.setFont("Helvetica-Bold", 17)
    canvas_obj.drawString(20 * mm, H - 26, "STAR HEALTH")
    canvas_obj.setFont("Helvetica", 9)
    canvas_obj.drawString(20 * mm, H - 41, "Star Health and Allied Insurance Co. Ltd.")

    canvas_obj.setFillColor(STAR_RED)
    canvas_obj.rect(W - 65 * mm, H - 40, 45 * mm, 12 * mm, fill=1, stroke=0)
    canvas_obj.setFillColor(WHITE)
    canvas_obj.setFont("Helvetica-Bold", 9)
    canvas_obj.drawCentredString(W - 42.5 * mm, H - 35, "CASHLESS CLAIM FORM")

    canvas_obj.setFillColor(STAR_BLUE)
    canvas_obj.rect(0, 0, W, 20, fill=1, stroke=0)
    canvas_obj.setFillColor(WHITE)
    canvas_obj.setFont("Helvetica", 7)
    canvas_obj.drawCentredString(W / 2, 7, "This is a synthetic test document generated for the ACOS on Radeon submission — not a real patient record.")
    canvas_obj.restoreState()


styles = getSampleStyleSheet()
label_style = ParagraphStyle("label", parent=styles["Normal"], fontSize=9, textColor=DARK_GREY, fontName="Helvetica-Bold")
value_style = ParagraphStyle("value", parent=styles["Normal"], fontSize=9, textColor=colors.black, fontName="Helvetica")
section_style = ParagraphStyle("section", parent=styles["Normal"], fontSize=10.5, textColor=WHITE, fontName="Helvetica-Bold")
title_style = ParagraphStyle("title", parent=styles["Normal"], fontSize=13, alignment=TA_CENTER, fontName="Helvetica-Bold", textColor=STAR_BLUE)


def section_bar(text):
    t = Table([[Paragraph(text, section_style)]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), STAR_BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t


def field_row(pairs):
    """pairs: list of (label, value) tuples. Single column, one field per row —
    pdfplumber's text extraction reads a page roughly top-to-bottom in reading
    order, and a 2-column side-by-side layout gets flattened into
    'Label1 Label2 \n Value1 Value2' rather than per-cell, which breaks every
    regex expecting 'Label\\nValue' immediately after it (confirmed: a 2-column
    version of this form extracted patient_name as 'Gender', pulled from the
    adjacent column's label). Single column costs vertical space but stays
    reliably in reading order.
    """
    rows = [[Paragraph(f"<b>{label}</b>", label_style), Paragraph(value, value_style)] for label, value in pairs]
    t = Table(rows, colWidths=[55 * mm, 115 * mm])
    t.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 2.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, MID_GREY),
    ]))
    return t


story = []
story.append(Spacer(1, 2 * mm))
story.append(Paragraph("CASHLESS HOSPITALISATION CLAIM", title_style))
story.append(Spacer(1, 2 * mm))
story.append(Paragraph("(As per IRDAI Standard Cashless Claim Format)", ParagraphStyle("sub", parent=styles["Normal"], fontSize=9, alignment=TA_CENTER, textColor=DARK_GREY)))
story.append(Spacer(1, 3 * mm))

story.append(field_row([
    ("Policy Number", "STAR-COMP-2024-001"),
    ("Company / TPA ID", "MDI-2026-CHN-0417"),
]))
story.append(field_row([
    ("Member Number", "STAR-2024-200099"),
    ("Sum Insured (Rs)", "15,00,000"),
]))
story.append(Spacer(1, 2 * mm))

story.append(section_bar("DETAILS OF PRIMARY INSURED"))
story.append(field_row([
    ("Name", "Priya Ramachandran"),
    ("Relationship", "Self"),
]))
story.append(field_row([
    ("Address", "14, Kamarajar Salai, T. Nagar, Chennai"),
    ("Phone No", "9840012233"),
]))
story.append(Spacer(1, 2 * mm))

story.append(section_bar("DETAILS OF INSURED PERSON HOSPITALIZED"))
story.append(field_row([
    ("Name", "Priya Ramachandran"),
    ("Gender", "Female"),
]))
story.append(field_row([
    ("Date of Birth", "18 April 1985"),
    ("Occupation", "Service"),
]))
story.append(Spacer(1, 2 * mm))

story.append(section_bar("HOSPITALIZATION DETAILS"))
story.append(field_row([
    ("Hospital Name", "City General Hospital, Chennai"),
    ("Room Category occupied", "Single occupancy"),
]))
story.append(field_row([
    ("Date of Admission", "05/02/2026"),
    ("Date of Discharge", "10/02/2026"),
]))
story.append(field_row([
    ("Primary Diagnosis", "N20.0 - Calculus of kidney"),
    ("Hospitalisation due to", "Illness"),
]))
story.append(field_row([
    ("Cashless Authorization No", "PA-STAR-2026-CHN-99012"),
    ("GIPSA Package", "Empanelled — Lithotripsy Package"),
]))
story.append(Spacer(1, 2 * mm))

story.append(section_bar("SERVICES & BILLED AMOUNTS"))
story.append(Spacer(1, 2 * mm))

line_items = [
    ["#", "Code", "Description", "Amount (Rs)"],
    ["1", "ROOM-01", "Deluxe AC Room Rent, single occupancy (5 days)", "45,000.00"],
    ["2", "99215", "Specialist Consultation - Urologist", "8,000.00"],
    ["3", "74170", "CT Scan - KUB (Kidney Ureter Bladder)", "12,500.00"],
    ["4", "85025", "Complete Blood Count and Lab Panel", "6,000.00"],
    ["5", "43239", "Lithotripsy Procedure (ESWL)", "48,000.00"],
    ["6", "PHARM-01", "Medicines and Consumables", "11,000.00"],
]
t = Table(line_items, colWidths=[8 * mm, 22 * mm, 105 * mm, 30 * mm])
t.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), LIGHT_BLUE),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
    ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ("ALIGN", (3, 0), (3, -1), "RIGHT"),
    ("GRID", (0, 0), (-1, -1), 0.4, MID_GREY),
    ("TOPPADDING", (0, 0), (-1, -1), 4),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
]))
story.append(t)
story.append(Spacer(1, 2 * mm))
story.append(Paragraph("TOTAL BILLED", ParagraphStyle("tb", parent=styles["Normal"], fontSize=9, fontName="Helvetica-Bold")))
story.append(Spacer(1, 3 * mm))

story.append(HRFlowable(width="100%", thickness=0.6, color=MID_GREY))
story.append(Spacer(1, 3 * mm))
story.append(Paragraph("Total Submitted Claim Amount: INR 1,30,500.00", ParagraphStyle("total", parent=styles["Normal"], fontSize=11, fontName="Helvetica-Bold", textColor=STAR_RED)))
story.append(Spacer(1, 3 * mm))

story.append(Paragraph(
    "I hereby declare that the information given above is true to the best of my knowledge. "
    "This is a synthetic document generated for demonstration purposes only.",
    ParagraphStyle("decl", parent=styles["Normal"], fontSize=7.5, textColor=DARK_GREY),
))

doc = SimpleDocTemplate(
    OUTPUT_PATH, pagesize=A4,
    topMargin=62, bottomMargin=24, leftMargin=20 * mm, rightMargin=20 * mm,
)
doc.build(story, onFirstPage=draw_header_footer, onLaterPages=draw_header_footer)
print(f"Generated: {OUTPUT_PATH}")
