-- Feedbacks table (Keycloak-backed identities; store user_id/responded_by as external identifiers)
CREATE TABLE IF NOT EXISTS feedbacks (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'general')),
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    rating INTEGER DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed')),
    priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    admin_response TEXT,
    responded_at TIMESTAMP,
    responded_by VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP
);

-- Indexes for feedbacks
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_id ON feedbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_email ON feedbacks(user_email);
CREATE INDEX IF NOT EXISTS idx_feedbacks_category ON feedbacks(category);
CREATE INDEX IF NOT EXISTS idx_feedbacks_status ON feedbacks(status);
CREATE INDEX IF NOT EXISTS idx_feedbacks_priority ON feedbacks(priority);
CREATE INDEX IF NOT EXISTS idx_feedbacks_responded_by ON feedbacks(responded_by);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_at ON feedbacks(created_at);
CREATE INDEX IF NOT EXISTS idx_feedbacks_deleted_at ON feedbacks(deleted_at);

-- Composite indexes
CREATE INDEX IF NOT EXISTS idx_feedbacks_status_created_at ON feedbacks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_category_status ON feedbacks(category, status);

-- Trigger function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers
DROP TRIGGER IF EXISTS update_feedbacks_updated_at ON feedbacks;
CREATE TRIGGER update_feedbacks_updated_at
BEFORE UPDATE ON feedbacks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- No local users table or sample data: users resolved via Keycloak at runtime

-- Documentation
COMMENT ON TABLE feedbacks IS 'User feedback: bug reports, feature requests, improvements, general comments';
COMMENT ON COLUMN feedbacks.category IS 'bug, feature, improvement, general';
COMMENT ON COLUMN feedbacks.user_email IS 'User primary email address (from Keycloak token)';
COMMENT ON COLUMN feedbacks.user_name IS 'User display name (fallback if none)';
COMMENT ON COLUMN feedbacks.status IS 'pending, in_progress, resolved, closed';
COMMENT ON COLUMN feedbacks.priority IS 'low, medium, high, critical';
COMMENT ON COLUMN feedbacks.rating IS 'User rating (0–5 stars)';
COMMENT ON COLUMN feedbacks.admin_response IS 'Admin response';
COMMENT ON COLUMN feedbacks.responded_at IS 'Admin response timestamp';
COMMENT ON COLUMN feedbacks.responded_by IS 'Admin user ID who responded';
