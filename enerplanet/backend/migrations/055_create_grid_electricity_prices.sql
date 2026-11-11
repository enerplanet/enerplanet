-- Grid electricity prices per country, keyed by the canonical country
-- name models carry (geo.NormalizeCountry). The 'other' row applies to any
-- country without its own row and must not be removed.
CREATE TABLE IF NOT EXISTS grid_electricity_prices (
    country VARCHAR(64) PRIMARY KEY,
    import_ct_per_kwh NUMERIC(8,3) NOT NULL CHECK (import_ct_per_kwh > 0),
    export_ct_per_kwh NUMERIC(8,3) NOT NULL DEFAULT 0 CHECK (export_ct_per_kwh >= 0),
    source TEXT NOT NULL DEFAULT '',
    updated_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CHECK (export_ct_per_kwh <= import_ct_per_kwh)
);

INSERT INTO grid_electricity_prices (country, import_ct_per_kwh, export_ct_per_kwh, source) VALUES
    ('germany', 38.35, 7.70, 'Purchase: Eurostat household price incl. taxes, 2025 first half. Feed-in: EEG partial feed-in up to 10 kWp from August 2026'),
    ('other', 30, 0, 'Fixed tariff of the former Calliope template; no feed-in revenue')
ON CONFLICT (country) DO NOTHING;

-- The prices a model's latest MEME run used, shown with its results.
ALTER TABLE model_meme_runs ADD COLUMN IF NOT EXISTS grid_import_ct_per_kwh NUMERIC(8,3);
ALTER TABLE model_meme_runs ADD COLUMN IF NOT EXISTS grid_export_ct_per_kwh NUMERIC(8,3);
