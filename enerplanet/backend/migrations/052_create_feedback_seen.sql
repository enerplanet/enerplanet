-- The first expert who opened a feedback entry. An entry without a row is
-- unseen, which the admin dashboard highlights.
CREATE TABLE IF NOT EXISTS feedback_seen (
    feedback_id INTEGER PRIMARY KEY REFERENCES feedbacks(id) ON DELETE CASCADE,
    seen_by VARCHAR(255) NOT NULL,
    seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
