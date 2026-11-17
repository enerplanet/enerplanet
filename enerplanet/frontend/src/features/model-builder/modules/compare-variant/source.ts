/**
 * The comparison source slot — what `compare-variant` needs from a host, and nothing more.
 *
 * The module declares that it *can* read the result summaries of the two models it compares and never learns
 * how: the fetch goes over the app's HTTP client to the backend's own structured-results endpoint, and a module
 * may not import that client. A host installs the implementation at startup — the same slot shape
 * `result-overview` uses for its summary: an interface, a module-scope value, an installer and a getter.
 *
 * **There is no default.** The fetch genuinely leaves the process, so there is nothing local to fall back to
 * and a fabricated summary would be a lie about the backend. A missing gateway is therefore an error the UI
 * reports, naming the installer.
 *
 * **Both sides come through this one slot.** A comparison is two models, so the slot answers per model id and
 * the view calls it twice; there is no separate root/variant shape to keep in step, and the two legs cannot
 * drift.
 *
 * **`null` is "no results", a rejection is a failed fetch.** The endpoint answers a model that has not been run
 * with no data, which is a legitimate, common state — a variant is a copy of the *model*, not of its results
 * (`duplicateModel` copies the config), so a freshly made variant has none until someone runs it. The gateway
 * reports that as `null` and reserves a rejection for a request that actually failed, so the view can say
 * "not run yet" and "could not load" as two different things.
 *
 * **The load lives here, outside React, and installing is what asks for it.** A module's regions mount *before*
 * the shell's install effect runs — React runs child effects before parent ones — so a mount-time `useEffect`
 * that read the gateway would find it `null`, bail, and never be retried (`modules/README.md`, "A source slot is
 * installed *after* your effects run"). So the UI asks through `requestCompareVariant`, which records the pair
 * even when no gateway is installed yet, and `setCompareVariantGateway` starts the load the moment one arrives.
 * The same shape as `result-overview/source.ts`.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { ModelVariant } from "@model-builder/core";

/**
 * A model run's result summary — only what the comparison shows, and only fields the structured endpoint
 * serves. The shape is deliberately small: it is what one glance at two sides can honestly be built from, not a
 * copy of the results feature's payload. Units follow the results feature's own reading of the same endpoint
 * (`features/model-results`): the totals are `sum_production`/`sum_consumption`, so kWh; `peak_demand` is a
 * power maximum, so kW.
 */
export interface CompareVariantSummary {
  /** Production over the run, kWh (`sum_production`). */
  sumProduction: number;
  /** Consumption over the run, kWh (`sum_consumption`). */
  sumConsumption: number;
  /** Peak demand over the run, kW (`peak_demand`). */
  peakDemand: number;
}

/**
 * What a host must provide for this module to compare: one model's result summary.
 *
 * Resolve with `null` when the model has no results yet (a legitimate state the UI names), and reject when the
 * request itself failed — a different claim the UI reports differently.
 */
export interface CompareVariantGateway {
  /** The model's result summary, `null` when it has none. Rejects when the backend cannot answer. */
  summary(modelId: number): Promise<CompareVariantSummary | null>;
}

/** One side's load state. */
export type SideStatus = "loading" | "ready" | "empty" | "failed";

/** What the view knows about one side. */
export interface SideState {
  status: SideStatus;
  /** The side's summary once it has arrived; `null` while it is owed, absent, or after a failure. */
  summary: CompareVariantSummary | null;
}

/** Both sides, keyed by role — the two models a comparison is over. */
export interface CompareVariantState {
  root: SideState;
  variant: SideState;
}

/** The pair of models a comparison is over: the family's root original and the variant. */
export interface CompareRequest {
  rootModelId: number;
  variantModelId: number;
}

/** A side that is owed an answer: nothing fetched yet, or a fetch in flight. */
const LOADING: SideState = { status: "loading", summary: null };

function loadingState(): CompareVariantState {
  return { root: { ...LOADING }, variant: { ...LOADING } };
}

let gateway: CompareVariantGateway | null = null;
let requested: CompareRequest | null = null;
let state: CompareVariantState = loadingState();
let inFlight: { key: string; promises: Promise<void>[] } | null = null;
const listeners = new Set<() => void>();

function publish(next: CompareVariantState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/**
 * Install the gateway. The frame calls this at startup, the way it installs the results-overview gateway.
 *
 * Installing is what asks for the pair: a request already recorded is loaded here, which is what makes the
 * child-before-parent effect order harmless. Passing `null` **forgets everything** — the pending pair and the
 * old gateway's answers — because with no gateway there is nothing to serve and a new one may report
 * differently.
 */
export function setCompareVariantGateway(next: CompareVariantGateway | null): void {
  gateway = next;
  inFlight = null;
  if (next === null) {
    requested = null;
    publish(loadingState());
    return;
  }
  if (requested !== null) void loadCompare(requested);
  else publish(loadingState());
}

/** The installed gateway, or null when no host has provided one. There is no default (see the file comment). */
export function compareVariantGateway(): CompareVariantGateway | null {
  return gateway;
}

/**
 * Ask for both sides of a comparison. Called by the view on mount and by the installer when a gateway arrives
 * late.
 *
 * Deduplicated: a second ask for the pair already on screen changes nothing, so a re-render is not a second
 * pair of requests. A *different* pair — the frame moved to another node, or another session — starts a fresh
 * load.
 */
export function requestCompareVariant(rootModelId: number, variantModelId: number): void {
  if (
    requested !== null &&
    requested.rootModelId === rootModelId &&
    requested.variantModelId === variantModelId
  ) {
    return;
  }
  requested = { rootModelId, variantModelId };
  state = loadingState();
  publish(state);
  if (gateway !== null) void loadCompare(requested);
}

/** Run both loads for `request`, once per pair. A stale answer is dropped: a newer pair wins. */
function loadCompare(request: CompareRequest): Promise<void> {
  const installed = gateway;
  if (installed === null) return Promise.resolve();

  const key = `${request.rootModelId}:${request.variantModelId}`;
  if (inFlight !== null && inFlight.key === key) {
    return Promise.all(inFlight.promises).then(() => undefined);
  }

  const root = loadSide(installed, request, "root", request.rootModelId);
  const variant = loadSide(installed, request, "variant", request.variantModelId);
  inFlight = { key, promises: [root, variant] };
  return Promise.all([root, variant]).then(() => {
    if (inFlight !== null && inFlight.key === key) inFlight = null;
  });
}

/** Load one side, publishing its outcome. A stale answer (a newer request) is dropped. */
function loadSide(
  installed: CompareVariantGateway,
  request: CompareRequest,
  side: keyof CompareVariantState,
  modelId: number,
): Promise<void> {
  return installed.summary(modelId).then(
    (summary) => {
      if (requested !== request) return;
      const next: SideState =
        summary === null ? { status: "empty", summary: null } : { status: "ready", summary };
      state = { ...state, [side]: next };
      publish(state);
    },
    () => {
      if (requested !== request) return;
      state = { ...state, [side]: { status: "failed", summary: null } };
      publish(state);
    },
  );
}

/** Subscribe to the view's state — the shape `useSyncExternalStore` wants. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The view's state right now. */
export function compareVariantState(): CompareVariantState {
  return state;
}

/**
 * The view's state for a variant, asking for both sides on mount. The third `useSyncExternalStore` argument is
 * the SSR snapshot — the view is also rendered to a string in tests, which needs one.
 */
export function useCompareVariant(variant: ModelVariant | undefined): CompareVariantState {
  const snapshot = useSyncExternalStore(subscribe, compareVariantState, compareVariantState);
  const rootModelId = variant?.rootModelId;
  const variantModelId = variant?.variantModelId;
  useEffect(() => {
    if (rootModelId !== undefined && variantModelId !== undefined) {
      requestCompareVariant(rootModelId, variantModelId);
    }
  }, [rootModelId, variantModelId]);
  return snapshot;
}
