-- Migration 032: India cashless pipeline enhancements to advance_claims
-- Adds columns required by the full compliance pipeline:
--   fhir_resource_id         — HAPI FHIR Claim resource ID after storage
--   bpmn_process_instance_id — Operaton process instance ID for lifecycle tracking
--   abha_address             — Patient's Ayushman Bharat Health Account address
--   consent_verified         — Whether ABDM consent was verified
--   fwa_anomaly_score        — Isolation Forest anomaly score (0.0–1.0)
--   irdai_violations         — JSONB array of IRDAI clause violation strings

ALTER TABLE advance_claims
    ADD COLUMN IF NOT EXISTS fhir_resource_id          VARCHAR(255),
    ADD COLUMN IF NOT EXISTS bpmn_process_instance_id  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS abha_address              VARCHAR(255),
    ADD COLUMN IF NOT EXISTS consent_verified          BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS fwa_anomaly_score         NUMERIC(6,4),
    ADD COLUMN IF NOT EXISTS irdai_violations          JSONB;

-- Index for BPMN process instance lookups (worker polls by process ID)
CREATE INDEX IF NOT EXISTS idx_advance_claims_bpmn
    ON advance_claims(bpmn_process_instance_id)
    WHERE bpmn_process_instance_id IS NOT NULL;

-- Index for ABHA address lookups (consent verification)
CREATE INDEX IF NOT EXISTS idx_advance_claims_abha
    ON advance_claims(abha_address)
    WHERE abha_address IS NOT NULL;

-- Index for FHIR resource ID lookups
CREATE INDEX IF NOT EXISTS idx_advance_claims_fhir
    ON advance_claims(fhir_resource_id)
    WHERE fhir_resource_id IS NOT NULL;
