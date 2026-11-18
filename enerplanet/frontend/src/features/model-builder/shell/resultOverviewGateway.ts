/**
 * The results-overview gateway the frame installs — the backend's structured-results endpoint, through the
 * app's HTTP client.
 *
 * The module declares the slot (`modules/result-overview/source.ts`) and never learns which gateway it has;
 * this is the implementation a host provides, beside the MEME-run gateway and for the same reason — a module
 * may only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's. The module
 * is told about this one at startup (`setResultOverviewGateway`, via `installResultOverviewGateway`).
 *
 * **The endpoint is `GET /models/:id/results/structured`.** Of the two results endpoints, this is the one that
 * answers a small summary: the handler's own note calls it "all small summary result tables"
 * (`internal/store/result/store.go`), while `GET /models/:id/results` returns the raw result rows. It is also
 * the very endpoint the results page and the compare page read, so this summary agrees with the page the link
 * opens — see `features/model-results/api.ts`, `fetchStructuredResults`.
 *
 * **Copied, not imported.** A feature may not import another feature, so the envelope and the handful of
 * fields read below are copied from `features/model-results/types.ts` (`StructuredModelResults`): the response
 * is `{ success, data }`, and the summary uses the top-level totals `sum_production`, `sum_consumption`,
 * `peak_demand`, `timestep_count`, the `carrier_summaries` keys and the `coordinates` count. Every other field
 * the endpoint serves — the per-location tables, the cost and capacity rows — is ignored here; the full page
 * is where those belong.
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
 * The fields of `StructuredModelResults` this summary reads, and none of the rest.
 *
 * Copied from `features/model-results/types.ts`. All optional on purpose: the endpoint omits a table it has no
 * rows for, so a field may legitimately be absent and is only then read as zero.
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
