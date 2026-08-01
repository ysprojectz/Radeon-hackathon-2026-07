-- Add attachment metadata to support tickets.
-- Stores a JSON array of filenames (e.g. ["screenshot.png", "error.pdf"]).
-- NULL means no attachments; an empty array is never written.

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN support_tickets.attachments IS
    'JSON array of stored attachment filenames for this ticket.';
