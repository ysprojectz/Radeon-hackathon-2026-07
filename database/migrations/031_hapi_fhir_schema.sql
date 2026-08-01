-- Migration 031: HAPI FHIR R4 server schema
-- Creates a dedicated schema for the HAPI FHIR server so it can
-- manage its own tables (FHIR resources, history, search params) without
-- polluting the public schema.

CREATE SCHEMA IF NOT EXISTS hapi_fhir;
GRANT ALL PRIVILEGES ON SCHEMA hapi_fhir TO claims_admin;
GRANT CREATE ON SCHEMA hapi_fhir TO claims_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA hapi_fhir
    GRANT ALL ON TABLES TO claims_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA hapi_fhir
    GRANT ALL ON SEQUENCES TO claims_admin;
