-- A failed run reported through the feedback form, copied from the model's
-- results when the report was sent, so a later run of the model leaves the
-- report as it was. model_id has no foreign key: the report outlives the model.
CREATE TABLE IF NOT EXISTS feedback_run_reports (
    feedback_id INTEGER PRIMARY KEY REFERENCES feedbacks(id) ON DELETE CASCADE,
    model_id INTEGER NOT NULL,
    model_title VARCHAR(255) NOT NULL,
    failed_stage TEXT,
    failed_service TEXT,
    error TEXT,
    failed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
