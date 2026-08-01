-- Migration 004: Add telemetry and storage event types
-- These event types are emitted during PDF upload handling.
-- Safe to run on existing DBs: ALTER TYPE ADD VALUE IF NOT EXISTS is idempotent.

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'PDF_UPLOADED';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'DOCUMENT_VALIDATION_GATE';
