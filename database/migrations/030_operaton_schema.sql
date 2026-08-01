-- Migration 030: Operaton BPMN engine schema
-- Creates a dedicated schema for the Operaton process engine so it can
-- manage its own tables without polluting the public schema.

CREATE SCHEMA IF NOT EXISTS operaton;
GRANT ALL PRIVILEGES ON SCHEMA operaton TO claims_admin;
GRANT CREATE ON SCHEMA operaton TO claims_admin;

-- Allow Operaton to create tables in its schema
ALTER DEFAULT PRIVILEGES IN SCHEMA operaton
    GRANT ALL ON TABLES TO claims_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA operaton
    GRANT ALL ON SEQUENCES TO claims_admin;
