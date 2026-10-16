/**
 * The calls the building configurator package makes, carried over this
 * application's own axios instance, so they inherit the session cookie, the
 * CSRF header and the token refresh on 401. Paths are relative to the API root,
 * which axios's baseURL already supplies.
 *
 * The lookups are a module constant and the full services are built once per
 * model or draft: the package keys its effects on these functions, so a new
 * identity on every render would re-run them.
 */

import type {
  BuemBuildingRunResponse,
  ConfiguratorServices,
  IgnisCalculateResponse,
  IgnisDataResponse,
  IgnisMatchResponse,
} from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

/** Bounds on the wait, matching the budgets ConfiguratorServices documents. */
const LOOKUP_TIMEOUT_MS = 8000;
const CALCULATE_TIMEOUT_MS = 15000;

/** The backend wraps an ignis answer as { data }; BuEM's comes back bare. */
interface Enveloped<T> {
  data: T;
}

export const variantLookups: Omit<ConfiguratorServices, 'runBuemBuilding'> = {
  async fetchMatchingVariants(countryIso2, typeCode, constructionYear) {
    const res = await axios.get<Enveloped<IgnisMatchResponse>>(
      `/v2/ignis/variants/${encodeURIComponent(countryIso2)}/match`,
      {
        params: { type: typeCode, year: String(constructionYear) },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    return res.data.data;
  },

  async fetchVariantData(variantCode) {
    const res = await axios.get<Enveloped<IgnisDataResponse>>(
      `/v2/ignis/data/${encodeURIComponent(variantCode)}`,
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    return res.data.data;
  },

  async calculateHeatDemand(variantCode, inputs) {
    const res = await axios.post<Enveloped<IgnisCalculateResponse>>(
      `/v2/ignis/calculate/${encodeURIComponent(variantCode)}`,
      inputs,
      { signal: AbortSignal.timeout(CALCULATE_TIMEOUT_MS) },
    );
    return res.data.data;
  },
};

/**
 * The services for a building of one model or draft. ownerPath is
 * "models/<id>" or "drafts/<id>"; a BuEM run goes to that owner's stored
 * route, which keeps the result and answers with the building's demand summary,
 * also handed to onStored.
 */
export function configuratorServicesFor(
  ownerPath: string,
  onStored: (profile: BuemBuildingRunResponse) => void,
): ConfiguratorServices {
  return {
    ...variantLookups,
    async runBuemBuilding(request) {
      const res = await axios.post<BuemBuildingRunResponse>(
        `/${ownerPath}/buildings/${encodeURIComponent(request.osm_id)}/buem`,
        request,
      );
      onStored(res.data);
      return res.data;
    },
  };
}
