-- Hourly series stored once per distinct result, linked to drafts and models
-- by reference. Generated results (BuEM, PV) are shared by key across owners;
-- uploaded ones belong to their owner and are never shared.
CREATE TABLE IF NOT EXISTS series_profiles (
    id BIGSERIAL PRIMARY KEY,
    -- Content hash: of the full producer request plus the producer's version
    -- for generated results, of the owner plus the file contents for uploads.
    key VARCHAR(64) NOT NULL,
    origin VARCHAR(16) NOT NULL,
    owner_user_id VARCHAR(255),
    producer_version VARCHAR(255),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    resolution_minutes INTEGER NOT NULL,
    -- The producer's own summary block (totals, peaks, intensity) as returned.
    summary JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_series_profiles_key UNIQUE (key),
    CONSTRAINT ck_series_profiles_origin CHECK (origin IN ('buem', 'pv', 'uploaded')),
    CONSTRAINT ck_series_profiles_owner CHECK ((origin = 'uploaded') = (owner_user_id IS NOT NULL)),
    CONSTRAINT ck_series_profiles_resolution CHECK (resolution_minutes > 0)
);

-- One row per series of a profile; values are energy per step in `unit`.
CREATE TABLE IF NOT EXISTS series_values (
    profile_id BIGINT NOT NULL,
    series VARCHAR(32) NOT NULL,
    unit VARCHAR(16) NOT NULL,
    vals REAL[] NOT NULL,

    PRIMARY KEY (profile_id, series),
    CONSTRAINT fk_series_values_profile FOREIGN KEY (profile_id) REFERENCES series_profiles(id) ON DELETE CASCADE
);

-- Which profile each series of each building (or roof face) of a draft or
-- model uses. Exactly one of model_id and draft_id is set; revision is the
-- owner's config hash when the link was written.
CREATE TABLE IF NOT EXISTS series_links (
    id BIGSERIAL PRIMARY KEY,
    model_id INTEGER,
    draft_id VARCHAR(255),
    building_ref VARCHAR(255) NOT NULL,
    -- Roof face id for a PV series, empty for a whole-building series.
    part VARCHAR(255) NOT NULL DEFAULT '',
    series VARCHAR(32) NOT NULL,
    profile_id BIGINT NOT NULL,
    source VARCHAR(16) NOT NULL,
    revision VARCHAR(64) NOT NULL,
    linked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_series_links_model FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
    CONSTRAINT fk_series_links_profile FOREIGN KEY (profile_id) REFERENCES series_profiles(id),
    CONSTRAINT ck_series_links_owner CHECK ((model_id IS NULL) <> (draft_id IS NULL)),
    CONSTRAINT ck_series_links_source CHECK (source IN ('default', 'user', 'uploaded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_series_links_model
    ON series_links (model_id, building_ref, part, series) WHERE model_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_series_links_draft
    ON series_links (draft_id, building_ref, part, series) WHERE draft_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_series_links_profile_id ON series_links (profile_id);
