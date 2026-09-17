/**
 * Merges a PyLovo building footprint (generate-grid) with its City2TABULA
 * envelope data (city2tabula/enrich), keyed by osm_id, into the same BUEM
 * Feature shape buemAdapter.ts already knows how to read — see
 * modelDataMap.ts's `thematic` and `geometry` paths. No new parsing logic:
 * this only reshapes enrich's fields onto those existing paths and hands the
 * result to adaptBuemFeature.
 *
 * u_value is always null in enrich's envelope elements — City2TABULA
 * resolves geometry only, not thermal properties (see enerplanet backend's
 * docs/city2tabula-enrich.md). Resolved here from ignis instead, via the
 * same TABULA-archetype mechanism the refurbishment-level selector already
 * uses (ignisAdapter.ts's resetElementsToVariantDefaults) — this is that
 * mechanism's other caller, not a new one.
 */

import type { EnrichEntry } from './heatService';
import { adaptBuemFeature, type BuildingState } from './buemAdapter';
import { fetchVariantData, loadVariantLevels } from './heatService';
import { ignisInputsFromTabulaData, resetElementsToVariantDefaults, type IgnisInputs } from './ignisAdapter';

interface PylovoBuildingFeature {
  type: 'Feature';
  geometry: unknown;
  properties: { osm_id: string; [key: string]: unknown };
}

/** tabula_variant_code segments: <country>.<region>.<type>.<period>.... e.g. "NL.N.SFH.02.Deta.ReEx.001.001". */
function parseVariantCode(code: string | undefined): { country: string; buildingTypeCode: string } {
  const parts = (code ?? '').split('.');
  return {
    country: parts[0] ?? '',
    buildingTypeCode: parts[2] ?? '',
  };
}

/**
 * First [lon, lat] vertex found in a Polygon/MultiPolygon geometry, recursing
 * through the nested ring arrays. modelDataMap.ts's `thematic.coordinates`
 * path expects geometry.coordinates to already be a bare [lon, lat] pair (a
 * Point, as every other feature source here uses) — a building footprint
 * polygon needs reducing to one representative point first.
 */
function firstVertex(geometry: unknown): [number, number] {
  let node = (geometry as { coordinates?: unknown } | undefined)?.coordinates;
  while (Array.isArray(node) && typeof node[0] !== 'number') {
    node = node[0];
  }
  return Array.isArray(node) && node.length === 2 ? (node as [number, number]) : [0, 0];
}

/**
 * Builds the synthetic BUEM feature for one building, ready for
 * adaptBuemFeature. footprint_area is a per-storey ground footprint, not the
 * total conditioned floor area BUEM's A_ref expects — multiplied by
 * n_storeys here, same convention as computeTotalFloorArea elsewhere (see
 * building-configurator's own CLAUDE.md on the floorArea/A_ref split).
 */
export function buildEnrichedFeature(building: PylovoBuildingFeature, entry: EnrichEntry): unknown {
  const { country, buildingTypeCode } = parseVariantCode(entry.tabula_variant_code);
  const nStoreys = entry.buem.building.n_storeys ?? 1;
  const footprintArea = entry.buem.building.footprint_area;

  return {
    id: building.properties.osm_id,
    geometry: { type: 'Point', coordinates: firstVertex(building.geometry) },
    properties: {
      buem: {
        building: {
          building_type: buildingTypeCode,
          construction_period: entry.default_construction_year ?? 0,
          country,
          A_ref: footprintArea
            ? { value: footprintArea.value * nStoreys, unit: footprintArea.unit }
            : { value: 0, unit: 'm2' },
          h_room: entry.buem.building.h_room ?? { value: 0, unit: 'm' },
          n_storeys: nStoreys,
          envelope: entry.buem.building.envelope,
        },
      },
    },
  };
}

/**
 * Resolves a building's TABULA archetype U-values from ignis: the variant
 * City2TABULA already classified it as, or (per docs/city2tabula-enrich.md,
 * "absent when City2TABULA matched the building geometry but no TABULA
 * archetype") a country/type/year match, same as a from-scratch building
 * gets. `cache` is keyed by variant code (or the type/year/country fallback
 * key) so buildings sharing an archetype — the common case across a whole
 * bbox — only fetch it once.
 */
async function resolveVariantData(
  entry: EnrichEntry,
  building: BuildingState,
  cache: Map<string, IgnisInputs | undefined>,
): Promise<IgnisInputs | undefined> {
  const { country, buildingType, constructionYear } = building.identity;
  const cacheKey = entry.tabula_variant_code ?? `${country}/${buildingType}/${constructionYear}`;

  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, await (async () => {
      if (entry.tabula_variant_code) {
        const dataRes = await fetchVariantData(entry.tabula_variant_code);
        if (dataRes) return ignisInputsFromTabulaData(dataRes.tabula_data);
      }
      const variants = await loadVariantLevels(country, buildingType, constructionYear);
      return variants[0]?.data;
    })());
  }

  return cache.get(cacheKey);
}

/**
 * Builds one building's BuildingState from its PyLovo footprint and its
 * City2TABULA envelope, resolving the envelope's U-values from the TABULA
 * archetype (enrich returns geometry only, never thermal properties).
 */
export async function buildBuildingState(
  building: PylovoBuildingFeature,
  entry: EnrichEntry,
  variantCache: Map<string, IgnisInputs | undefined> = new Map(),
): Promise<BuildingState> {
  const feature = buildEnrichedFeature(building, entry);
  const state = adaptBuemFeature(feature);
  const variantData = await resolveVariantData(entry, state, variantCache);
  const envelope = variantData
    ? resetElementsToVariantDefaults(state.envelope, variantData)
    : state.envelope;
  return { ...state, envelope, thematic: { ...state.thematic, envelope } };
}

/**
 * Joins a generate-grid buildings FeatureCollection with an enrich response
 * on osm_id, returning a BuildingState per resolved building, keyed by
 * osm_id. Buildings with no entry in `enrichData` (city2tabula's `missing`
 * list) are skipped: they have no envelope to show. One variant cache is
 * shared across the batch, so an archetype is fetched once however many
 * buildings share it.
 */
export async function buildBuildingStates(
  buildings: { features: PylovoBuildingFeature[] },
  enrichData: Record<string, EnrichEntry>,
): Promise<Record<string, BuildingState>> {
  const variantCache = new Map<string, IgnisInputs | undefined>();

  const entries = await Promise.all(
    buildings.features.flatMap((building) => {
      const entry = enrichData[building.properties.osm_id];
      if (!entry) return [];
      return [(async () =>
        [building.properties.osm_id, await buildBuildingState(building, entry, variantCache)] as const)()];
    }),
  );

  return Object.fromEntries(entries);
}
