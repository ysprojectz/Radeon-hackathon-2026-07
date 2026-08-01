-- Migration 033: Keycloak IAM schema
-- Creates a dedicated schema for Keycloak so it can manage its own
-- tables (realms, users, sessions, clients) without polluting the public schema.

CREATE SCHEMA IF NOT EXISTS keycloak;
GRANT ALL PRIVILEGES ON SCHEMA keycloak TO claims_admin;
GRANT CREATE ON SCHEMA keycloak TO claims_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA keycloak
    GRANT ALL ON TABLES TO claims_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA keycloak
    GRANT ALL ON SEQUENCES TO claims_admin;
