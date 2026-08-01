-- Persist dashboard Todo & Task workflow fields.

CREATE TABLE IF NOT EXISTS calendar_events (
    id          TEXT PRIMARY KEY,
    user_email  TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'CUSTOM',
    title       TEXT NOT NULL,
    href        TEXT,
    notes       TEXT,
    location    TEXT,
    status      TEXT NOT NULL DEFAULT 'OPEN',
    priority    TEXT NOT NULL DEFAULT 'MEDIUM',
    reminder_minutes INTEGER DEFAULT 30,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER DEFAULT 30;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_date
    ON calendar_events(user_email, date, time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_user_status
    ON calendar_events(user_email, status, date);
