-- ============================================================
-- MIGRATION 039 — Backfill Claim Lifecycle State
-- Idempotently maps existing claims into the first-class lifecycle
-- tables introduced in migration 038. This is intentionally
-- additive: it does not rewrite business outcome statuses.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH claim_stage AS (
    SELECT
        claim_reference,
        COALESCE(tenant_id, 'default') AS tenant_id,
        CASE
            WHEN status IN ('HITL_PENDING', 'HITL_IN_REVIEW') THEN 'hitl_routing'
            WHEN status IN ('SETTLED', 'DENIED') THEN 'persistence'
            WHEN status = 'ERROR' THEN 'error'
            ELSE 'adjudication'
        END AS stage,
        CASE
            WHEN status IN ('SETTLED', 'DENIED') THEN 'COMPLETED'
            WHEN status = 'ERROR' THEN 'FAILED'
            WHEN status IN ('HITL_PENDING', 'HITL_IN_REVIEW') THEN 'IN_PROGRESS'
            ELSE 'IN_PROGRESS'
        END AS state,
        COALESCE(date_adjudicated, updated_at, created_at, NOW()) AS stage_time,
        status::TEXT AS claim_status,
        processing_time_ms
    FROM claims
)
UPDATE claims c
SET current_stage = cs.stage,
    current_stage_status = cs.state,
    current_stage_started_at = COALESCE(c.current_stage_started_at, cs.stage_time),
    lifecycle_updated_at = COALESCE(c.lifecycle_updated_at, cs.stage_time),
    lifecycle_blocker = CASE
        WHEN cs.stage = 'hitl_routing' THEN COALESCE(c.lifecycle_blocker, 'Claim is waiting for human review')
        WHEN cs.stage = 'error' THEN COALESCE(c.lifecycle_blocker, 'Claim processing ended in error')
        ELSE c.lifecycle_blocker
    END,
    next_action = CASE
        WHEN cs.stage = 'hitl_routing' THEN COALESCE(c.next_action, 'Review and decide the HITL work item')
        WHEN cs.stage = 'error' THEN COALESCE(c.next_action, 'Inspect audit trail and retry or close')
        ELSE c.next_action
    END
FROM claim_stage cs
WHERE c.claim_reference = cs.claim_reference
  AND c.current_stage IS NULL;

WITH claim_stage AS (
    SELECT
        claim_reference,
        COALESCE(tenant_id, 'default') AS tenant_id,
        CASE
            WHEN status IN ('HITL_PENDING', 'HITL_IN_REVIEW') THEN 'hitl_routing'
            WHEN status IN ('SETTLED', 'DENIED') THEN 'persistence'
            WHEN status = 'ERROR' THEN 'error'
            ELSE 'adjudication'
        END AS stage,
        CASE
            WHEN status IN ('SETTLED', 'DENIED') THEN 'COMPLETED'
            WHEN status = 'ERROR' THEN 'FAILED'
            WHEN status IN ('HITL_PENDING', 'HITL_IN_REVIEW') THEN 'IN_PROGRESS'
            ELSE 'IN_PROGRESS'
        END AS state,
        COALESCE(date_received, created_at, NOW()) AS started_at,
        CASE
            WHEN status IN ('SETTLED', 'DENIED', 'ERROR') THEN COALESCE(date_adjudicated, updated_at, created_at, NOW())
            ELSE NULL
        END AS completed_at,
        status::TEXT AS claim_status,
        processing_time_ms
    FROM claims
)
INSERT INTO claim_lifecycle_events (
    claim_reference,
    tenant_id,
    stage,
    state,
    started_at,
    completed_at,
    duration_ms,
    owner_role,
    actor_type,
    actor_id,
    reason,
    severity,
    source_service,
    payload,
    event_hash,
    created_at
)
SELECT
    claim_reference,
    tenant_id,
    stage,
    state,
    started_at,
    completed_at,
    processing_time_ms,
    CASE
        WHEN stage = 'hitl_routing' THEN 'HITL'
        WHEN stage = 'error' THEN 'OPERATIONS'
        ELSE 'SYSTEM'
    END,
    'SYSTEM',
    'migration-039',
    'Backfilled lifecycle state from existing claim status',
    CASE
        WHEN state = 'FAILED' THEN 'HIGH'
        WHEN state = 'IN_PROGRESS' THEN 'MEDIUM'
        ELSE 'INFO'
    END,
    'migration',
    jsonb_build_object('claim_status', claim_status, 'backfilled', true),
    encode(digest('migration-039:' || claim_reference || ':' || stage || ':' || state, 'sha256'), 'hex'),
    COALESCE(completed_at, started_at, NOW())
FROM claim_stage
ON CONFLICT (event_hash) DO NOTHING;
