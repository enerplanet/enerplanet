-- Defaults for the other countries with region data. Purchase prices use the same
-- Eurostat half as Germany; feed-in prices are typical 2026 values where no statutory
-- tariff applies. Inserts only missing rows, so an administrator's edit stays.
INSERT INTO grid_electricity_prices (country, import_ct_per_kwh, export_ct_per_kwh, source) VALUES
    ('austria', 29.05, 7.6, E'Purchase: Eurostat household price incl. taxes, 2025 first half\nFeed-in: OeMAG market price, 2026 average of January to September'),
    ('czechia', 31.79, 2, E'Purchase: Eurostat household price incl. taxes, 2025 first half\nFeed-in: typical supplier buyback, no statutory tariff'),
    ('netherlands', 23.85, 5, E'Purchase: Eurostat household price incl. taxes, 2025 first half\nFeed-in: typical supplier payment once net metering ends in 2027')
ON CONFLICT (country) DO NOTHING;
