-- Purchase and feed-in sources on separate lines, as the price information shows
-- each line apart. Matches only the seeded text, so an administrator's edit stays.
UPDATE grid_electricity_prices
SET source = E'Purchase: Eurostat household price incl. taxes, 2025 first half\nFeed-in: EEG partial feed-in up to 10 kWp from August 2026'
WHERE country = 'germany'
  AND source = 'Purchase: Eurostat household price incl. taxes, 2025 first half. Feed-in: EEG partial feed-in up to 10 kWp from August 2026';
