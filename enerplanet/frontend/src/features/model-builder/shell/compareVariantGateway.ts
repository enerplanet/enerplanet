/**
 * The comparison gateway the frame installs — the backend's structured-results endpoint, through the app's
 * HTTP client.
 *
 * The module declares the slot (`modules/compare-variant/source.ts`) and never learns which gateway it has.
 * The envelope and fields read here are copied from `features/model-results/types.ts`.
 */

import axios from "@/lib/axios";
import {
  setCompareVariantGateway,
  type CompareVariantGateway,
  type CompareVariantSummary,
} from "../modules/compare-variant";

/** The envelope the result endpoints answer with (`httputil.SuccessResponse`). */
interface ResultEnvelope {
  success?: boolean;
  data?: StructuredPayload;
}

/**
 * The fields of `StructuredModelResults` this summary reads, and none of the rest. Copied from
 * `features/model-results/types.ts`; optional because the endpoint omits a value it has none of.
 */
interface StructuredPayload {
  sum_production?: number;
  sum_consumption?: number;
  peak_demand?: number;
}

/** The payload as the summary's shape, or `null` when the model has no results. Pure and exported so it is testable directly. */
export function summaryOf(payload: StructuredPayload | undefined): CompareVariantSummary | null {
  if (payload === undefined) return null;
  return {
    sumProduction: payload.sum_production ?? 0,
    sumConsumption: payload.sum_consumption ?? 0,
    peakDemand: payload.peak_demand ?? 0,
  };
}

export const backendCompareVariantGateway: CompareVariantGateway = {
  async summary(modelId) {
    const response = await axios.get<ResultEnvelope>(`/models/${modelId}/results/structured`);
    return summaryOf(response.data?.data);
  },
};

/** Install it. Called once, at startup, beside the results-overview and variant gateways. */
export function installCompareVariantGateway(): void {
  setCompareVariantGateway(backendCompareVariantGateway);
}
