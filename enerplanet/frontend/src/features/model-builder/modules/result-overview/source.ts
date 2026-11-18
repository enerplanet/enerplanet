/**
 * The results-overview source slot — what `result-overview` needs from a host, and nothing more.
 *
 * The module declares that it *can* read a model run's result summary and never learns how: the fetch goes
 * over the app's HTTP client to the backend's own results endpoint, and a module may not import that client.
 * A host installs the implementation at startup — the same slot shape `building-demand` uses for its demand
 * source and `run-meme-calliope` uses for its gateway: an interface, a module-scope value, an installer and
 * a getter.
 *
 * **There is no default.** Unlike the `auto` template's area-summary slot, this fetch genuinely leaves the
 * process, so there is nothing local to fall back to and a fabricated summary would be a lie about the
 * backend. A missing gateway is therefore an error the UI reports, naming the installer — exactly as
 * `run-meme-calliope` throws when no gateway is installed.
 *
 * **The load lives here, outside React, and installing is what asks for it.** A module's regions mount
 * *before* the shell's install effect runs — React runs child effects before parent ones — so a mount-time
 * `useEffect` that read the gateway would find it `null`, bail, and never be retried
 * (`modules/README.md`, "A source slot is installed *after* your effects run"). So the UI asks through
 * `requestResultOverview`, which records the model even when no gateway is installed yet, and
 * `setResultOverviewGateway` starts the load the moment one arrives. The same shape as `model-start/regions.ts`.
 */

import { useEffect, useSyncExternalStore } from "react";

/**
 * A model run's result summary — only what the module shows, and only fields the structured endpoint serves.
 *
 * The shape is deliberately small: it is what one glance at the results page's numbers can honestly be built
 * from, not a copy of the results feature's payload. Units follow the results feature's own reading of the
 * same endpoint (`features/model-results`: totals are `totalKwh`, so the sums are kWh; `peak_demand` is a
 * power maximum, so kW).
 */
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

/**
 * Install the gateway. The frame calls this at startup, the way it installs the demand source.
 *
 * Installing is what asks for the summary: a model already requested is loaded here, which is what makes the
 * child-before-parent effect order harmless. Passing `null` **forgets everything** — the pending request and
 * the old gateway's answer — because with no gateway there is nothing to serve and a new one may report
 * differently.
 */
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

/**
 * Ask for a model's summary. Called by the view on mount and by the installer when a gateway arrives late.
 *
 * Deduplicated: a second ask for the model already on screen changes nothing, so a re-render is not a second
 * request. A *different* model — the frame moved to another node, or another session — starts a fresh load.
 */
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

/**
 * The view's state for `modelId`, asking for it on mount. The third `useSyncExternalStore` argument is the
 * SSR snapshot — the view is also rendered to a string in tests, which needs one.
 */
export function useResultOverview(modelId: number | undefined): ResultOverviewState {
  const snapshot = useSyncExternalStore(subscribe, overviewState, overviewState);
  useEffect(() => {
    if (modelId !== undefined) requestResultOverview(modelId);
  }, [modelId]);
  return snapshot;
}
