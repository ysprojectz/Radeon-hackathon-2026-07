-- Migration 003: Add missing audit_event_type enum values
-- These event types are emitted by the pipeline but were missing from the initial schema.
-- Safe to run on existing DBs: ALTER TYPE ADD VALUE IF NOT EXISTS is idempotent.

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'REGULATORY_VIOLATION_DETECTED';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'REASONING_SKIPPED';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'DUAL_AGENT_VALIDATION';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'PROVIDER_SWITCHED';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'LLM_SKIPPED';
