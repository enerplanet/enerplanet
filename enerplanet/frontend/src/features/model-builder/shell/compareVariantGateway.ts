/**
 * The comparison gateway the frame installs — the backend's structured-results endpoint, through the app's HTTP
 * client.
 *
 * The module declares the slot (`modules/compare-variant/source.ts`) and never learns which gateway it has;
 * this is the implementation a host provides, beside the results-overview gateway and for the same reason — a
 * module may only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's. The
 * module is told about this one at startup (`setCompareVariantGateway`, via `installCompareVariantGateway`).
 *
 * **The endpoint is `GET /models/:id/results/structured`** — the same one `result-overview` reads, and the same
 * one the results page and the compare page read (`features/model-results/api.ts`, `fetchStructuredResults`). Of
 * the two results endpoints it is the one that answers a small summary; the raw one
 * (`GET /models/:id/results`) returns the full result rows, which the full page is for.
 *
 * **Copied, not imported.** A feature may not import another feature, so the envelope and the few fields read
 * below are copied from `features/model-results/types.ts` (`StructuredModelResults`): the response is
 * `{ success, data }`, and the summary uses the top-level totals `sum_production`, `sum_consumption` and
 * `peak_demand`. Every other field the endpoint serves is ignored here; the full page is where those belong.
 *
 * **Absent data is `null`, a thrown request is not.** A model that has not been run answers with no data, which
 * is a legitimate state the view names; only a request that actually failed rejects, so the two never blur.
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
 * The fields of `StructuredModelResults` this summary reads, and none of the rest.
 *
 * Copied from `features/model-results/types.ts`. Optional on purpose: the endpoint omits a value it has none of,
 * so a field may legitimately be absent and is only then read as zero.
 */
interface StructuredPayload {
  sum_production?: number;
  sum_consumption?: number;
  peak_demand?: number;
}

/**
 * The payload as the summary's shape, or `null` when the model has no results. Pure and exported so it is
 * testable directly.
 */
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
