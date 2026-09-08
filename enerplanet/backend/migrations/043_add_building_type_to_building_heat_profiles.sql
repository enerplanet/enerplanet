-- building_type is the building_type run_buem sent to BuEM for this row:
-- a TABULA residential type (SFH, TH, MFH, AB) or a BuEM service id
-- (bakery, clinic, hotel, office, restaurant, school, supermarket,
-- warehouse). For a service building BuEM does not model hot water or
-- cooking, so hot_water_kwh_a and kitchen_kwh_a are reported as 0 rather
-- than measured; readers should treat them as not modelled.
ALTER TABLE building_heat_profiles ADD COLUMN IF NOT EXISTS building_type VARCHAR(32);
