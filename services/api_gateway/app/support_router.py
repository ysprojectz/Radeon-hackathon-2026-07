"""
Support ticket router.
User-created support tickets persisted in PostgreSQL.

Attachments (PNG / JPG / PDF, max 5 MB each) are stored on disk under
UPLOAD_DIR/support/<ticket_id>/ and their filenames are persisted in the
support_tickets.attachments JSONB column (migration 029).
"""
import json
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

from services.api_gateway.app.auth import CurrentUser, get_current_user, require_roles

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/support", tags=["support"])
admin_router = APIRouter(prefix="/api/v1/admin/support", tags=["support-admin"])
_admin_only = require_roles("ADMIN")
_SAFE_CLAIM_REFERENCE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")

INSERT_SUPPORT_TICKET_SQL = text("""
    INSERT INTO support_tickets (
        id, user_email, subject, description,
        category, priority, status, attachments,
        claim_reference, page_route, market_region, tenant_id
    )
    VALUES (
        :id, :email, :subject, :description,
        :category, :priority, 'OPEN', CAST(:attachments AS jsonb),
        :claim_reference, :page_route, :market_region, :tenant_id
    )
    RETURNING *
""")

# ── Attachment storage ────────────────────────────────────────────────────────

_SUPPORT_UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/app/uploads")) / "support"

ALLOWED_MIME_TYPES = {"image/png", "image/jpeg", "application/pdf"}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".pdf"}
MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024  # 5 MB

# Sanitise filenames: keep only safe characters
_SAFE_FILENAME_RE = re.compile(r"[^\w.\-]")


def _safe_filename(name: str) -> str:
    stem = Path(name).stem
    suffix = Path(name).suffix.lower()
    safe_stem = _SAFE_FILENAME_RE.sub("_", stem)[:80]
    return f"{safe_stem}{suffix}"


def _ticket_upload_dir(ticket_id: str) -> Path:
    return _SUPPORT_UPLOAD_DIR / ticket_id


def _cleanup_attachments(ticket_id: str) -> None:
    """Remove the upload directory for a ticket whose DB insert failed."""
    import shutil
    dest_dir = _ticket_upload_dir(ticket_id)
    if dest_dir.exists():
        try:
            shutil.rmtree(dest_dir)
            logger.info("support attachment cleanup: removed %s", dest_dir)
        except Exception as exc:
            logger.warning("support attachment cleanup failed for %s: %s", ticket_id, exc)


async def _save_attachments(ticket_id: str, files: List[UploadFile]) -> List[str]:
    """Validate, store, and return the list of saved filenames."""
    if not files:
        return []

    dest_dir = _ticket_upload_dir(ticket_id)
    dest_dir.mkdir(parents=True, exist_ok=True)

    saved: List[str] = []
    for upload in files:
        # Skip empty slots (FastAPI sends an empty UploadFile when the field is absent)
        if not upload.filename:
            continue

        content_type = upload.content_type or ""
        ext = Path(upload.filename).suffix.lower()

        if content_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=415,
                detail=(
                    f'Attachment "{upload.filename}" has an unsupported type '
                    f"({content_type}). Accepted: PNG, JPG, PDF."
                ),
            )

        data = await upload.read()
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f'Attachment "{upload.filename}" exceeds the 5 MB limit.',
            )
        if not data:
            continue

        filename = _safe_filename(upload.filename)
        # Avoid collisions when the same name is uploaded twice
        dest = dest_dir / filename
        if dest.exists():
            filename = f"{uuid.uuid4().hex[:8]}_{filename}"
            dest = dest_dir / filename

        dest.write_bytes(data)
        saved.append(filename)
        logger.info("support attachment saved: ticket=%s file=%s size=%d", ticket_id, filename, len(data))

    return saved


# ── Pydantic schemas ──────────────────────────────────────────────────────────


class SupportTicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=140)
    description: str = Field(min_length=5, max_length=2000)
    category: str = "GENERAL"
    priority: str = "MEDIUM"
    claim_reference: Optional[str] = Field(default=None, max_length=80)
    page_route: str = Field(default="", max_length=255)


class SupportTicketUpdate(BaseModel):
    status: str
    resolution_notes: Optional[str] = Field(default=None, max_length=2000)


class SupportTicketOut(BaseModel):
    id: str
    subject: str
    description: str
    category: str
    priority: str
    status: str
    created_by: str
    created_at: str
    updated_at: str
    attachments: List[str] = []
    claim_reference: Optional[str] = None
    page_route: str = ""
    market_region: str = ""
    tenant_id: str = "default"
    resolution_notes: str = ""
    resolved_by: Optional[str] = None
    resolved_at: Optional[str] = None


class SupportTicketAdminUpdate(BaseModel):
    status: str
    resolution_notes: Optional[str] = Field(default=None, max_length=2000)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _ensure_table(sess):
    # Schema is owned by database migrations. Runtime DDL hides deploy gaps and
    # can block request handling under production traffic.
    return None


def _format_datetime(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _normalize_claim_reference(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if not _SAFE_CLAIM_REFERENCE_RE.match(normalized):
        raise HTTPException(status_code=400, detail="Unsupported claim reference format")
    return normalized


def _safe_download_filename(filename: str) -> str:
    candidate = filename.strip()
    if not candidate or Path(candidate).name != candidate:
        raise HTTPException(status_code=400, detail="Invalid attachment name")
    return candidate


def _build_attachment_response(ticket_id: str, filename: str) -> FileResponse:
    safe_name = _safe_download_filename(filename)
    allowed_root = _ticket_upload_dir(ticket_id).resolve()
    document_path = (allowed_root / safe_name).resolve()
    if allowed_root not in document_path.parents or not document_path.exists():
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(path=str(document_path), filename=safe_name)


def _row_to_ticket(row) -> SupportTicketOut:
    raw_attachments = getattr(row, "attachments", None)
    if isinstance(raw_attachments, list):
        attachments = raw_attachments
    elif isinstance(raw_attachments, str):
        try:
            attachments = json.loads(raw_attachments)
        except Exception:
            attachments = []
    else:
        attachments = []

    return SupportTicketOut(
        id=row.id,
        subject=row.subject,
        description=row.description,
        category=row.category,
        priority=row.priority,
        status=row.status,
        created_by=row.user_email,
        created_at=_format_datetime(row.created_at) or "",
        updated_at=_format_datetime(row.updated_at) or "",
        attachments=attachments,
        claim_reference=getattr(row, "claim_reference", None),
        page_route=getattr(row, "page_route", "") or "",
        market_region=getattr(row, "market_region", "") or "",
        tenant_id=getattr(row, "tenant_id", "default") or "default",
        resolution_notes=getattr(row, "resolution_notes", "") or "",
        resolved_by=getattr(row, "resolved_by", None),
        resolved_at=_format_datetime(getattr(row, "resolved_at", None)),
    )


# ── User routes ───────────────────────────────────────────────────────────────


@router.get("/tickets", response_model=list[SupportTicketOut])
async def list_tickets(current_user: CurrentUser = Depends(get_current_user)):
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            rows = sess.execute(
                text("""
                    SELECT * FROM support_tickets
                    WHERE user_email = :email
                    ORDER BY updated_at DESC, created_at DESC
                """),
                {"email": current_user.email},
            ).fetchall()
            return [_row_to_ticket(row) for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("support ticket list failed: %s", exc)
        raise HTTPException(
            status_code=500, detail="Support ticket persistence unavailable"
        )


@router.post("/tickets", response_model=SupportTicketOut, status_code=201)
async def create_ticket(
    current_user: CurrentUser = Depends(get_current_user),
    # Form fields (sent as multipart/form-data when attachments are included,
    # or as application/json via the JSON-only path in the Next.js proxy).
    subject: str = Form(..., min_length=3, max_length=140),
    description: str = Form(..., min_length=5, max_length=2000),
    category: str = Form("GENERAL"),
    priority: str = Form("MEDIUM"),
    claim_reference: Optional[str] = Form(default=None),
    page_route: str = Form(default=""),
    attachments: List[UploadFile] = File(default=[]),
):
    ticket_id = str(uuid.uuid4())
    normalized_claim_reference = _normalize_claim_reference(claim_reference)

    # Persist files first so we can roll back cleanly if the DB write fails
    saved_files = await _save_attachments(ticket_id, attachments)

    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                # Clean up any files already saved before raising
                _cleanup_attachments(ticket_id)
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            row = sess.execute(
                INSERT_SUPPORT_TICKET_SQL,
                {
                    "id": ticket_id,
                    "email": current_user.email,
                    "subject": subject.strip(),
                    "description": description.strip(),
                    "category": category,
                    "priority": priority,
                    "attachments": json.dumps(saved_files),
                    "claim_reference": normalized_claim_reference,
                    "page_route": (page_route or "").strip()[:255],
                    "market_region": (current_user.market_region or "").upper(),
                    "tenant_id": current_user.tenant_id or "default",
                },
            ).fetchone()
            sess.commit()
            return _row_to_ticket(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("support ticket create failed: %s", exc)
        _cleanup_attachments(ticket_id)
        raise HTTPException(status_code=500, detail="Could not create support ticket")


@router.get("/tickets/{ticket_id}/attachments/{filename}")
async def download_ticket_attachment(
    ticket_id: str,
    filename: str,
    current_user: CurrentUser = Depends(get_current_user),
):
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            row = sess.execute(
                text("""
                    SELECT attachments
                    FROM support_tickets
                    WHERE id = :id AND user_email = :email
                """),
                {"id": ticket_id, "email": current_user.email},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Ticket not found")
            attachments = row.attachments if isinstance(row.attachments, list) else json.loads(row.attachments or "[]")
            if filename not in attachments:
                raise HTTPException(status_code=404, detail="Attachment not found")
            return _build_attachment_response(ticket_id, filename)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("support attachment download failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not download attachment")


@router.patch("/tickets/{ticket_id}", response_model=SupportTicketOut)
async def update_ticket(
    ticket_id: str,
    body: SupportTicketUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    allowed = {"OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
    status = body.status.upper()
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported ticket status")
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            row = sess.execute(
                text("""
                    UPDATE support_tickets
                    SET status = :status,
                        updated_at = NOW(),
                        resolution_notes = COALESCE(:resolution_notes, resolution_notes),
                        resolved_by = CASE
                            WHEN :status IN ('RESOLVED', 'CLOSED') THEN :resolved_by
                            ELSE NULL
                        END,
                        resolved_at = CASE
                            WHEN :status IN ('RESOLVED', 'CLOSED') THEN NOW()
                            ELSE NULL
                        END
                    WHERE id = :id AND user_email = :email
                    RETURNING *
                """),
                {
                    "id": ticket_id,
                    "email": current_user.email,
                    "status": status,
                    "resolution_notes": body.resolution_notes.strip() if body.resolution_notes is not None else None,
                    "resolved_by": current_user.email,
                },
            ).fetchone()
            sess.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Ticket not found")
            return _row_to_ticket(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("support ticket update failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not update support ticket")


# ── Admin routes ──────────────────────────────────────────────────────────────


@admin_router.get("/tickets", response_model=list[SupportTicketOut])
async def list_all_tickets(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    _: CurrentUser = Depends(_admin_only),
):
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            filters = []
            params: dict = {}
            if status:
                filters.append("status = :status")
                params["status"] = status.upper()
            if priority:
                filters.append("priority = :priority")
                params["priority"] = priority.upper()
            if search:
                filters.append("""
                    (
                        user_email ILIKE :search
                        OR subject ILIKE :search
                        OR description ILIKE :search
                        OR COALESCE(claim_reference, '') ILIKE :search
                    )
                """)
                params["search"] = f"%{search.strip()}%"
            where_clause = f"WHERE {' AND '.join(filters)}" if filters else ""
            rows = sess.execute(
                text(f"""
                    SELECT * FROM support_tickets
                    {where_clause}
                    ORDER BY
                        CASE priority
                            WHEN 'URGENT' THEN 1
                            WHEN 'HIGH' THEN 2
                            WHEN 'MEDIUM' THEN 3
                            ELSE 4
                        END,
                        updated_at DESC,
                        created_at DESC
                """),
                params,
            ).fetchall()
            return [_row_to_ticket(row) for row in rows]
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin support ticket list failed: %s", exc)
        raise HTTPException(status_code=500, detail="Support ticket list unavailable")


@admin_router.get("/tickets/{ticket_id}/attachments/{filename}")
async def admin_download_ticket_attachment(
    ticket_id: str,
    filename: str,
    _: CurrentUser = Depends(_admin_only),
):
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            row = sess.execute(
                text("""
                    SELECT attachments
                    FROM support_tickets
                    WHERE id = :id
                """),
                {"id": ticket_id},
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Ticket not found")
            attachments = row.attachments if isinstance(row.attachments, list) else json.loads(row.attachments or "[]")
            if filename not in attachments:
                raise HTTPException(status_code=404, detail="Attachment not found")
            return _build_attachment_response(ticket_id, filename)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin support attachment download failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not download attachment")


@admin_router.patch("/tickets/{ticket_id}", response_model=SupportTicketOut)
async def admin_update_ticket(
    ticket_id: str,
    body: SupportTicketAdminUpdate,
    _: CurrentUser = Depends(_admin_only),
):
    allowed = {"OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"}
    status = body.status.upper()
    if status not in allowed:
        raise HTTPException(status_code=400, detail="Unsupported ticket status")
    try:
        from shared.db_sync import get_sync_session

        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            row = sess.execute(
                text("""
                    UPDATE support_tickets
                    SET status = :status,
                        updated_at = NOW(),
                        resolution_notes = COALESCE(:resolution_notes, resolution_notes),
                        resolved_by = CASE
                            WHEN :status IN ('RESOLVED', 'CLOSED') THEN :resolved_by
                            ELSE NULL
                        END,
                        resolved_at = CASE
                            WHEN :status IN ('RESOLVED', 'CLOSED') THEN NOW()
                            ELSE NULL
                        END
                    WHERE id = :id
                    RETURNING *
                """),
                {
                    "id": ticket_id,
                    "status": status,
                    "resolution_notes": body.resolution_notes.strip() if body.resolution_notes is not None else None,
                    "resolved_by": _.email,
                },
            ).fetchone()
            sess.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Ticket not found")
            return _row_to_ticket(row)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("admin support ticket update failed: %s", exc)
        raise HTTPException(status_code=500, detail="Could not update support ticket")
