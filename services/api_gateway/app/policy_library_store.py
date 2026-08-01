"""
Policy Library Store
====================
Manages uploaded policy documents (national/regulatory + company policies).

Storage layout (JSON file-per-policy):
  {POLICY_LIBRARY_PATH}/
    index.json              ← master index of all uploaded policies
    <uuid>.json             ← individual policy doc (clauses + metadata)

Policy types:
  NATIONAL  — country-wide government/regulatory mandates
               e.g. India: IRDAI Health Insurance Regulations
               e.g. UAE:   DHA Essential Benefits Package
  COMPANY   — insurance company-specific policy terms
               e.g. India: ICICI Lombard, HDFC Ergo, Star Health
               e.g. UAE:   Daman, NGI, Takaful Emarat

The pipeline queries this store for company-specific clauses at adjudication time,
supplementing (or replacing) the built-in fixture files.
"""
from __future__ import annotations

import json
import os
import threading
import tempfile
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_LIBRARY_PATH = Path(os.getenv(
    "POLICY_LIBRARY_PATH", "/opt/claims-engine/policy_library"
))
if not _LIBRARY_PATH.parent.exists():
    _LIBRARY_PATH = Path("/tmp/claims_policy_library")

_DOCUMENTS_PATH = Path(os.getenv(
    "POLICY_DOCUMENTS_PATH", "/opt/claims-engine/policy_documents"
))
if not _DOCUMENTS_PATH.parent.exists():
    _DOCUMENTS_PATH = Path("/tmp/claims_policy_documents")

_INDEX_FILE = _LIBRARY_PATH / "index.json"
_lock = threading.Lock()

VALID_MARKETS = {"UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"}
VALID_TYPES   = {"NATIONAL", "COMPANY"}


def _ensure_dir() -> None:
    _LIBRARY_PATH.mkdir(parents=True, exist_ok=True)
    _DOCUMENTS_PATH.mkdir(parents=True, exist_ok=True)


def _load_index() -> list[dict]:
    _ensure_dir()
    if not _INDEX_FILE.exists():
        return []
    try:
        return json.loads(_INDEX_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_index(index: list[dict]) -> None:
    _ensure_dir()
    fd, tmp = tempfile.mkstemp(dir=_LIBRARY_PATH, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, default=str)
        os.replace(tmp, _INDEX_FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _write_policy_file(policy_id: str, data: dict) -> None:
    _ensure_dir()
    path = _LIBRARY_PATH / f"{policy_id}.json"
    fd, tmp = tempfile.mkstemp(dir=_LIBRARY_PATH, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_policy_file(policy_id: str) -> Optional[dict]:
    path = _LIBRARY_PATH / f"{policy_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _write_pdf_file(policy_id: str, pdf_bytes: bytes) -> tuple[str, int]:
    """
    Write PDF bytes to disk.

    Returns:
        tuple: (document_path, file_size_bytes)
    """
    _ensure_dir()
    path = _DOCUMENTS_PATH / f"{policy_id}.pdf"
    fd, tmp = tempfile.mkstemp(dir=_DOCUMENTS_PATH, suffix=".pdf")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(pdf_bytes)
        os.replace(tmp, path)
        import logging
        logging.getLogger(__name__).info(
            "PDF stored: %s (%d bytes)", path, len(pdf_bytes)
        )
        return str(path), len(pdf_bytes)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read_pdf_file(policy_id: str) -> Optional[bytes]:
    """
    Read PDF bytes from disk.

    Returns:
        bytes or None if file doesn't exist
    """
    path = _DOCUMENTS_PATH / f"{policy_id}.pdf"
    if not path.exists():
        return None
    try:
        return path.read_bytes()
    except Exception:
        return None


# ── Public API ─────────────────────────────────────────────────────────────────

def list_policies(
    market: Optional[str] = None,
    policy_type: Optional[str] = None,
    insurer: Optional[str] = None,
) -> list[dict]:
    """Return the master index, optionally filtered."""
    with _lock:
        index = _load_index()
    results = index
    if market:
        results = [p for p in results if p.get("market", "").upper() == market.upper()]
    if policy_type:
        results = [p for p in results if p.get("policy_type", "").upper() == policy_type.upper()]
    if insurer:
        results = [p for p in results
                   if insurer.lower() in p.get("insurer_name", "").lower()]
    return results


def get_policy(policy_id: str) -> Optional[dict]:
    """Return full policy document including clauses."""
    with _lock:
        return _read_policy_file(policy_id)


def add_policy(
    market: str,
    policy_type: str,
    insurer_name: str,
    policy_name: str,
    effective_date: str,
    clauses: list[dict],
    uploaded_by: str = "system",
    source_filename: str = "",
    version: str = "1.0",
    pdf_bytes: Optional[bytes] = None,
    document_hash: Optional[str] = None,
) -> dict:
    """
    Add a new policy to the library.

    Args:
        market:       "UAE" | "KSA" | "INDIA" etc.
        policy_type:  "NATIONAL" | "COMPANY"
        insurer_name: For NATIONAL: regulatory body name (e.g. "IRDAI")
                      For COMPANY:  insurance company name (e.g. "ICICI Lombard")
        policy_name:  Human-readable name
        effective_date: ISO date string
        clauses:      List of clause dicts (from LLM extraction)
        uploaded_by:  User email
        source_filename: Original filename
        version:      Policy version string
        pdf_bytes:    Optional PDF file bytes to store
        document_hash: Optional SHA-256 hash of PDF

    Returns:
        The created policy entry (index record, no full clauses).
    """
    import logging
    logger = logging.getLogger(__name__)

    market     = market.upper()
    policy_type = policy_type.upper()

    if market not in VALID_MARKETS:
        raise ValueError(f"Invalid market: {market}. Must be one of {sorted(VALID_MARKETS)}")
    if policy_type not in VALID_TYPES:
        raise ValueError(f"Invalid policy_type: {policy_type}. Must be NATIONAL or COMPANY")

    policy_id = str(_uuid.uuid4())
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"

    # Full document (stored separately)
    doc = {
        "id":              policy_id,
        "market":          market,
        "policy_type":     policy_type,
        "insurer_name":    insurer_name,
        "policy_name":     policy_name,
        "effective_date":  effective_date,
        "version":         version,
        "source_filename": source_filename,
        "uploaded_by":     uploaded_by,
        "uploaded_at":     now,
        "clauses":         clauses,
        "clauses_count":   len(clauses),
    }

    # Store PDF if provided
    if pdf_bytes:
        try:
            document_path, file_size = _write_pdf_file(policy_id, pdf_bytes)
            doc["document_path"] = document_path
            doc["document_hash"] = document_hash or ""
            doc["file_size_bytes"] = file_size
            logger.info(
                "Policy %s: PDF stored at %s (%d bytes, hash=%s)",
                policy_id, document_path, file_size, document_hash[:16] if document_hash else "none"
            )
        except Exception as exc:
            logger.error("Failed to store PDF for policy %s: %s", policy_id, exc)
            # Continue without PDF storage - don't fail the entire operation
            doc["document_path"] = None
            doc["document_hash"] = None
            doc["file_size_bytes"] = 0
    else:
        doc["document_path"] = None
        doc["document_hash"] = None
        doc["file_size_bytes"] = 0

    # Index entry (lightweight, no clauses)
    index_entry = {k: v for k, v in doc.items() if k != "clauses"}

    with _lock:
        _write_policy_file(policy_id, doc)
        index = _load_index()
        index.append(index_entry)
        _save_index(index)

    return index_entry


def delete_policy(policy_id: str) -> bool:
    """Remove a policy from the library. Returns True if deleted."""
    import logging
    logger = logging.getLogger(__name__)

    with _lock:
        # Check if policy JSON exists
        path = _LIBRARY_PATH / f"{policy_id}.json"
        if not path.exists():
            return False

        # Read policy to get document path before deletion
        policy_data = _read_policy_file(policy_id)

        # Delete policy JSON
        path.unlink()

        # Delete PDF if it exists
        pdf_path = _DOCUMENTS_PATH / f"{policy_id}.pdf"
        if pdf_path.exists():
            try:
                pdf_path.unlink()
                logger.info("Deleted PDF for policy %s: %s", policy_id, pdf_path)
            except Exception as exc:
                logger.error("Failed to delete PDF for policy %s: %s", policy_id, exc)

        # Update index
        index = _load_index()
        index = [p for p in index if p.get("id") != policy_id]
        _save_index(index)

    return True


def get_policy_document(policy_id: str) -> Optional[bytes]:
    """
    Retrieve the PDF bytes for a policy.

    Returns:
        PDF bytes or None if not found/not stored.
    """
    with _lock:
        return _read_pdf_file(policy_id)


def get_clauses_for_pipeline(
    market: str,
    policy_type: str,
    insurer_name: Optional[str] = None,
) -> list[dict]:
    """
    Query clauses for use in the adjudication pipeline.

    For NATIONAL: returns all national clauses for the market.
    For COMPANY:  returns clauses for the specific insurer.

    Returns empty list if no matching policy found.
    """
    matches = list_policies(market=market, policy_type=policy_type, insurer=insurer_name)
    if not matches:
        return []

    # Use the most recent upload if multiple exist
    matches.sort(key=lambda p: p.get("uploaded_at", ""), reverse=True)
    best = matches[0]

    full_doc = get_policy(best["id"])
    if not full_doc:
        return []
    return full_doc.get("clauses", [])
