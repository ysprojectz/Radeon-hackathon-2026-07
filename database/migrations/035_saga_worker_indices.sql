-- Phase 2 saga worker groundwork: additive indexes for async saga lookups.
-- Existing tables are created in 010_enterprise_controls.sql.

CREATE INDEX IF NOT EXISTS idx_claim_sagas_trace_updated
    ON claim_processing_sagas(tenant_id, trace_id, updated_at DESC)
    WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_claim_sagas_step_status
    ON claim_processing_sagas(tenant_id, current_step, saga_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_claim_processing_events_type_time
    ON claim_processing_events(tenant_id, event_type, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_claim_processing_events_trace
    ON claim_processing_events(tenant_id, trace_id, event_timestamp DESC)
    WHERE trace_id IS NOT NULL;
