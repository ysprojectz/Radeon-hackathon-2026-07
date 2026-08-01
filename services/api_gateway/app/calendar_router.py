"""
Calendar Events Router
User-created calendar events persisted in PostgreSQL.
"""
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from services.api_gateway.app.auth import get_current_user, CurrentUser

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])

# ── Schemas ────────────────────────────────────────────────────────────────────

class CalendarEventIn(BaseModel):
    id: Optional[str] = None
    date: str           # YYYY-MM-DD
    time: str           # HH:MM
    type: str           # TODO_TASK | REMINDER | MEETING | SCHEDULE | DEADLINE | legacy types
    title: str
    href: Optional[str] = None
    notes: Optional[str] = None
    location: Optional[str] = None
    status: str = "OPEN"
    priority: str = "MEDIUM"
    reminder_minutes: Optional[int] = 30

class CalendarEventOut(CalendarEventIn):
    id: str
    created_by: str
    created_at: str
    updated_at: Optional[str] = None

# ── DB helpers ─────────────────────────────────────────────────────────────────

def _ensure_table(sess):
    # Schema is owned by database migrations. Runtime DDL hides deploy gaps and
    # can block request handling under production traffic.
    return None

# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CalendarEventOut])
async def list_events(current_user: CurrentUser = Depends(get_current_user)):
    try:
        from shared.db_sync import get_sync_session
        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            rows = sess.execute(
                text("SELECT * FROM calendar_events WHERE user_email = :email ORDER BY date, time"),
                {"email": current_user.email}
            ).fetchall()
            return [
                CalendarEventOut(
                    id=r.id, date=r.date, time=r.time, type=r.type,
                    title=r.title, href=r.href,
                    notes=r.notes, location=r.location, status=r.status,
                    priority=r.priority, reminder_minutes=r.reminder_minutes,
                    created_by=r.user_email,
                    created_at=r.created_at.isoformat() if hasattr(r.created_at, "isoformat") else str(r.created_at),
                    updated_at=r.updated_at.isoformat() if hasattr(r.updated_at, "isoformat") else str(r.updated_at),
                )
                for r in rows
            ]
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("calendar list failed: %s", e)
        raise HTTPException(status_code=500, detail="Calendar persistence unavailable")


@router.post("", response_model=CalendarEventOut, status_code=201)
async def create_event(body: CalendarEventIn, current_user: CurrentUser = Depends(get_current_user)):
    event_id = body.id or str(uuid.uuid4())
    try:
        from shared.db_sync import get_sync_session
        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            sess.execute(
                text("""
                    INSERT INTO calendar_events (
                        id, user_email, date, time, type, title, href,
                        notes, location, status, priority, reminder_minutes
                    )
                    VALUES (
                        :id, :email, :date, :time, :type, :title, :href,
                        :notes, :location, :status, :priority, :reminder_minutes
                    )
                    ON CONFLICT (id) DO UPDATE SET
                        title = EXCLUDED.title, date = EXCLUDED.date,
                        time = EXCLUDED.time, type = EXCLUDED.type, href = EXCLUDED.href,
                        notes = EXCLUDED.notes, location = EXCLUDED.location,
                        status = EXCLUDED.status, priority = EXCLUDED.priority,
                        reminder_minutes = EXCLUDED.reminder_minutes,
                        updated_at = NOW()
                """),
                {"id": event_id, "email": current_user.email,
                 "date": body.date, "time": body.time, "type": body.type,
                 "title": body.title, "href": body.href,
                 "notes": body.notes, "location": body.location,
                 "status": body.status, "priority": body.priority,
                 "reminder_minutes": body.reminder_minutes}
            )
            sess.commit()
    except HTTPException:
        raise
    except Exception as e:
        logger.error("calendar create failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    return CalendarEventOut(
        id=event_id, date=body.date, time=body.time, type=body.type,
        title=body.title, href=body.href, notes=body.notes, location=body.location,
        status=body.status, priority=body.priority, reminder_minutes=body.reminder_minutes,
        created_by=current_user.email,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        updated_at=datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
    )


@router.patch("/{event_id}", response_model=CalendarEventOut)
async def update_event(event_id: str, body: CalendarEventIn, current_user: CurrentUser = Depends(get_current_user)):
    try:
        from shared.db_sync import get_sync_session
        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            row = sess.execute(
                text("""
                    UPDATE calendar_events
                    SET date = :date, time = :time, type = :type, title = :title,
                        href = :href, notes = :notes, location = :location,
                        status = :status, priority = :priority,
                        reminder_minutes = :reminder_minutes, updated_at = NOW()
                    WHERE id = :id AND user_email = :email
                    RETURNING *
                """),
                {"id": event_id, "email": current_user.email,
                 "date": body.date, "time": body.time, "type": body.type,
                 "title": body.title, "href": body.href,
                 "notes": body.notes, "location": body.location,
                 "status": body.status, "priority": body.priority,
                 "reminder_minutes": body.reminder_minutes}
            ).fetchone()
            sess.commit()
            if not row:
                raise HTTPException(status_code=404, detail="Event not found")
            return CalendarEventOut(
                id=row.id, date=row.date, time=row.time, type=row.type,
                title=row.title, href=row.href, notes=row.notes,
                location=row.location, status=row.status, priority=row.priority,
                reminder_minutes=row.reminder_minutes, created_by=row.user_email,
                created_at=row.created_at.isoformat() if hasattr(row.created_at, "isoformat") else str(row.created_at),
                updated_at=row.updated_at.isoformat() if hasattr(row.updated_at, "isoformat") else str(row.updated_at),
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("calendar update failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{event_id}", status_code=204)
async def delete_event(event_id: str, current_user: CurrentUser = Depends(get_current_user)):
    try:
        from shared.db_sync import get_sync_session
        with get_sync_session() as sess:
            if not sess:
                raise HTTPException(status_code=503, detail="Database unavailable")
            _ensure_table(sess)
            result = sess.execute(
                text("DELETE FROM calendar_events WHERE id = :id AND user_email = :email"),
                {"id": event_id, "email": current_user.email}
            )
            sess.commit()
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Event not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("calendar delete failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))
