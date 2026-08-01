-- ============================================================
-- Claims Adjudication Engine — Database Migration 014
-- User Login Session Tracking with State Management
-- Adds comprehensive session tracking with ACTIVE/TERMINATED/BROKEN/RESTARTED states
-- ============================================================

-- ============================================================
-- Create SessionStatus enum
-- ============================================================

DO $$ BEGIN
    CREATE TYPE session_status AS ENUM (
        'ACTIVE',
        'TERMINATED',
        'BROKEN',
        'RESTARTED'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Create UserLoginSession table
-- ============================================================

CREATE TABLE IF NOT EXISTS user_login_sessions (
    -- Primary key
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- User relationship (required)
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Session identification
    session_id VARCHAR(64) UNIQUE NOT NULL,
    
    -- Session state tracking
    status session_status NOT NULL DEFAULT 'ACTIVE',
    
    -- Device and connection metadata
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    os_name VARCHAR(50),
    browser_name VARCHAR(50),
    browser_version VARCHAR(20),
    
    -- Location data
    city VARCHAR(100),
    country VARCHAR(100),
    location_data JSONB,
    metadata JSONB,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminated_at TIMESTAMPTZ,
    termination_reason TEXT,
    
    -- Constraints
    CONSTRAINT fk_user_login_session_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- Indexes for performance
-- ============================================================

-- Index for querying sessions by user
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_user_id
    ON user_login_sessions (user_id);

-- Index for querying sessions by status
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_status
    ON user_login_sessions (status);

-- Index for querying sessions by creation time
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_created_at
    ON user_login_sessions (created_at DESC);

-- Composite index for common queries (user + status + created_at)
CREATE INDEX IF NOT EXISTS idx_user_login_sessions_composite
    ON user_login_sessions (user_id, status, created_at DESC);

-- ============================================================
-- Comments
-- ============================================================

COMMENT ON TABLE user_login_sessions IS
    'Tracks user login sessions with state management (ACTIVE/TERMINATED/BROKEN/RESTARTED), location/IP/device metadata for audit and security purposes.';

COMMENT ON COLUMN user_login_sessions.status IS
    'Session state: ACTIVE (currently logged in), TERMINATED (properly logged out), BROKEN (error/exception), RESTARTED (session resumed).';

COMMENT ON COLUMN user_login_sessions.session_id IS
    'Unique session identifier for tracking across the application.';

COMMENT ON COLUMN user_login_sessions.location_data IS
    'Raw geolocation data (latitude, longitude, timezone, ISP) if available.';

COMMENT ON COLUMN user_login_sessions.metadata IS
    'Additional session metadata (device fingerprint, screen resolution, etc.).';

-- ============================================================
-- Trigger to update last_seen on row update
-- ============================================================

CREATE OR REPLACE FUNCTION update_user_login_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_seen = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_login_sessions_update ON user_login_sessions;
CREATE TRIGGER trg_user_login_sessions_update
    BEFORE UPDATE ON user_login_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_login_session_timestamp();
