-- One TentaCron MEME job per model: the request id is persisted so a dispatch
-- retry resumes the SAME TentaCron job by id instead of resubmitting. Because
-- TentaCron is itself a durable queue that polls MEME to completion, the
-- backend must never enqueue a duplicate run for a model while one is alive.
CREATE TABLE IF NOT EXISTS model_meme_runs (
    model_id INTEGER PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_model_meme_runs_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
);