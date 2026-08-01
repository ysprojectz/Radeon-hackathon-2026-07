-- Persist user-created product support tickets.

CREATE TABLE IF NOT EXISTS support_tickets (
    id          TEXT PRIMARY KEY,
    user_email  TEXT NOT NULL,
    subject     TEXT NOT NULL,
    description TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'GENERAL',
    priority    TEXT NOT NULL DEFAULT 'MEDIUM',
    status      TEXT NOT NULL DEFAULT 'OPEN',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_status
    ON support_tickets(user_email, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_created
    ON support_tickets(created_at DESC);
