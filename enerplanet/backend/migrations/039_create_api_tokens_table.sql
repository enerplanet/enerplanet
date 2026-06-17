-- Personal access tokens for per-user API access; only the SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
    id            BIGSERIAL PRIMARY KEY,
    user_id       VARCHAR(255) NOT NULL,
    user_email    VARCHAR(255) NOT NULL,
    name          VARCHAR(255) NOT NULL,
    token_hash    CHAR(64)     NOT NULL UNIQUE,
    token_prefix  VARCHAR(16)  NOT NULL,
    scope         VARCHAR(16)  NOT NULL DEFAULT 'read',
    access_level  VARCHAR(32)  NOT NULL DEFAULT 'intermediate',
    created_by    VARCHAR(255) NOT NULL,
    expires_at    TIMESTAMPTZ,
    last_used_at  TIMESTAMPTZ,
    revoked_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens (user_id);
