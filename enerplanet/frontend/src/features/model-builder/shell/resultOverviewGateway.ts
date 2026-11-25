/**
 * The results-overview gateway the frame installs — the backend's structured-results endpoint, through the
 * app's HTTP client.
 *
 * The module declares the slot (`modules/result-overview/source.ts`) and never learns which gateway it has.
 * The envelope and fields read here are copied from `features/model-results/types.ts`.
 */

import axios from "@/lib/axios";
import {
  setResultOverviewGateway,
  type ResultOverviewGateway,
  type ResultOverviewSummary,
} from "../modules/result-overview";

/** The envelope the result endpoints answer with (`httputil.SuccessResponse`). */
interface ResultEnvelope {
  success?: boolean;
  data?: StructuredPayload;
}

/**
 * The fields of `StructuredModelResults` this summary reads, and none of the rest. Copied from
 * `features/model-results/types.ts`; all optional because the endpoint omits a table it has no rows for.
 */
interface StructuredPayload {
  sum_production?: number;
  sum_consumption?: number;
  peak_demand?: number;
  timestep_count?: number;
  coordinates?: unknown[];
  carrier_summaries?: Record<string, unknown>;
}

/** The payload as the summary's shape — pure and exported so it is testable directly. */
export function summaryOf(payload: StructuredPayload | undefined): ResultOverviewSummary {
  return {
    carriers: Object.keys(payload?.carrier_summaries ?? {}),
    locationCount: (payload?.coordinates ?? []).length,
    sumProduction: payload?.sum_production ?? 0,
    sumConsumption: payload?.sum_consumption ?? 0,
    peakDemand: payload?.peak_demand ?? 0,
    timestepCount: payload?.timestep_count ?? 0,
  };
}

export const backendResultOverviewGateway: ResultOverviewGateway = {
  async summary(modelId) {
    const response = await axios.get<ResultEnvelope>(`/models/${modelId}/results/structured`);
    return summaryOf(response.data?.data);
  },
};

/** Install it. Called once, at startup, beside the MEME-run gateway. */
export function installResultOverviewGateway(): void {
  setResultOverviewGateway(backendResultOverviewGateway);
}
