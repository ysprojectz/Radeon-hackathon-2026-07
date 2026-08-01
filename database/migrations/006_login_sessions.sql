-- ============================================================
-- Claims Engine — Migration 006
-- Login Session Tracking
-- Captures IP, browser, device, OS, geolocation per login
-- ============================================================

CREATE TABLE IF NOT EXISTS login_sessions (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_email      VARCHAR(255) NOT NULL,
    user_role       VARCHAR(50)  NOT NULL,
    ip_address      VARCHAR(45)  NOT NULL,       -- IPv4 or IPv6 max 45 chars
    user_agent      TEXT,
    browser_name    VARCHAR(100),
    browser_version VARCHAR(50),
    os_name         VARCHAR(100),
    device_type     VARCHAR(20)  CHECK (device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'other')),
    country         VARCHAR(100),
    city            VARCHAR(100),
    market          VARCHAR(20),
    session_jti     VARCHAR(64),                 -- JWT jti claim (token fingerprint)
    login_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    logout_at       TIMESTAMPTZ,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast queries by user (most common admin view)
CREATE INDEX IF NOT EXISTS idx_login_sessions_user_login
    ON login_sessions (user_email, login_at DESC);

-- Fast queries by date range
CREATE INDEX IF NOT EXISTS idx_login_sessions_login_at
    ON login_sessions (login_at DESC);

-- Lookup by token JTI for logout matching
CREATE INDEX IF NOT EXISTS idx_login_sessions_jti
    ON login_sessions (session_jti)
    WHERE session_jti IS NOT NULL;

COMMENT ON TABLE login_sessions IS
    'Tracks every user login: IP, browser, OS, device, geolocation, and session lifecycle.';
