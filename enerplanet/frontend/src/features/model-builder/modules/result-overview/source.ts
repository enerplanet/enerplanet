/**
 * The results-overview source slot — what `result-overview` needs from a host, and nothing more.
 *
 * The module reads a model run's result summary through an injected gateway; the fetch goes over the app's
 * HTTP client, which a module may not import. There is no default. The load lives here, outside React;
 * installing the gateway is what starts it.
 */

import { useEffect, useSyncExternalStore } from "react";

/** A model run's result summary — the fields the module shows. Units: kWh for the sums, kW for peak demand. */
export interface ResultOverviewSummary {
  /** Carriers the run produced, from `carrier_summaries` — the raw labels, opaque. */
  carriers: string[];
  /** Locations that have result coordinates (`coordinates`). */
  locationCount: number;
  /** Production over the run, kWh (`sum_production`). */
  sumProduction: number;
  /** Consumption over the run, kWh (`sum_consumption`). */
  sumConsumption: number;
  /** Peak demand over the run, kW (`peak_demand`). */
  peakDemand: number;
  /** Timesteps in the run (`timestep_count`). */
  timestepCount: number;
}

/** What a host must provide for this module to show results: a model's summary. */
export interface ResultOverviewGateway {
  /** The model run's result summary. Rejects when the backend cannot answer. */
  summary(modelId: number): Promise<ResultOverviewSummary>;
}

/** What the view knows right now: the model asked about, its summary, and how the ask stands. */
export interface ResultOverviewState {
  /** The model the summary is for, or `null` before any ask. */
  modelId: number | null;
  /** The summary once it has arrived; `null` while it is owed or after a failure. */
  summary: ResultOverviewSummary | null;
  /** True while a load is in flight. */
  loading: boolean;
  /** True when the load itself failed — a different claim from an empty summary. */
  failed: boolean;
}

let gateway: ResultOverviewGateway | null = null;
let requested: number | null = null;
let state: ResultOverviewState = { modelId: null, summary: null, loading: false, failed: false };
let inFlight: { modelId: number; promise: Promise<void> } | null = null;
const listeners = new Set<() => void>();

function publish(next: ResultOverviewState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Install the gateway. Installing is what asks for a recorded model; passing `null` forgets everything. */
export function setResultOverviewGateway(next: ResultOverviewGateway | null): void {
  gateway = next;
  inFlight = null;
  if (next === null) {
    requested = null;
    publish({ modelId: null, summary: null, loading: false, failed: false });
    return;
  }
  state = { modelId: requested, summary: null, loading: false, failed: false };
  if (requested !== null) void loadOverview(requested);
  else publish(state);
}

/** The installed gateway, or null when no host has provided one. There is no default (see the file comment). */
export function resultOverviewGateway(): ResultOverviewGateway | null {
  return gateway;
}

/** Ask for a model's summary, on mount and from the installer when a gateway arrives late. Deduplicated per model. */
export function requestResultOverview(modelId: number): void {
  if (requested === modelId && (state.loading || state.summary !== null || state.failed)) return;
  requested = modelId;
  state = { modelId, summary: null, loading: gateway !== null, failed: false };
  publish(state);
  if (gateway !== null) void loadOverview(modelId);
}

/** Run a load for `modelId`, once at a time. A stale answer is dropped: a newer model wins. */
function loadOverview(modelId: number): Promise<void> {
  const installed = gateway;
  if (installed === null) return Promise.resolve();
  if (inFlight !== null && inFlight.modelId === modelId) return inFlight.promise;

  publish({ modelId, summary: null, loading: true, failed: false });
  const promise = installed
    .summary(modelId)
    .then((summary) => {
      if (requested === modelId) publish({ modelId, summary, loading: false, failed: false });
    })
    .catch(() => {
      if (requested === modelId) publish({ modelId, summary: null, loading: false, failed: true });
    })
    .finally(() => {
      if (inFlight !== null && inFlight.modelId === modelId) inFlight = null;
    });

  inFlight = { modelId, promise };
  return promise;
}

/** Subscribe to the view's state — the shape `useSyncExternalStore` wants. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The view's state right now. */
export function overviewState(): ResultOverviewState {
  return state;
}

/** The view's state for `modelId`, asking for it on mount. */
export function useResultOverview(modelId: number | undefined): ResultOverviewState {
  const snapshot = useSyncExternalStore(subscribe, overviewState, overviewState);
  useEffect(() => {
    if (modelId !== undefined) requestResultOverview(modelId);
  }, [modelId]);
  return snapshot;
}
