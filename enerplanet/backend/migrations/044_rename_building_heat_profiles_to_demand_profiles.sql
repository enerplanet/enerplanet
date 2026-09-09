-- Rename building_heat_profiles to building_demand_profiles: the table holds
-- heating, cooling, hot water, electricity and cooking per building, so
-- "heat" misnamed it. Renames every dependent object with it.
--
-- Migrations are re-applied on every run and 042 keeps creating the old
-- table name when it is absent, so after this rename has happened once a
-- later run finds an empty building_heat_profiles beside the renamed table.
-- That stub is dropped only when it is empty; a non-empty one is refused
-- rather than silently discarded.
DO $$
BEGIN
    IF to_regclass('building_demand_profiles') IS NULL THEN
        ALTER TABLE building_heat_profiles RENAME TO building_demand_profiles;
        ALTER SEQUENCE IF EXISTS building_heat_profiles_id_seq RENAME TO building_demand_profiles_id_seq;
        ALTER INDEX IF EXISTS building_heat_profiles_pkey RENAME TO building_demand_profiles_pkey;
        ALTER INDEX IF EXISTS idx_building_heat_profiles_model_id RENAME TO idx_building_demand_profiles_model_id;
        ALTER INDEX IF EXISTS idx_building_heat_profiles_status RENAME TO idx_building_demand_profiles_status;
        ALTER TABLE building_demand_profiles RENAME CONSTRAINT uq_building_heat_profiles_model_osm TO uq_building_demand_profiles_model_osm;
        ALTER TABLE building_demand_profiles RENAME CONSTRAINT fk_building_heat_profiles_model TO fk_building_demand_profiles_model;
    ELSIF to_regclass('building_heat_profiles') IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM building_heat_profiles) THEN
            RAISE EXCEPTION 'building_heat_profiles still holds rows after the rename to building_demand_profiles; refusing to drop it';
        END IF;
        DROP TABLE building_heat_profiles;
    END IF;
END
$$;
