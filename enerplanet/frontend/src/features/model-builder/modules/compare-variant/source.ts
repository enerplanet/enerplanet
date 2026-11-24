/**
 * The comparison source slot — what `compare-variant` needs from a host, and nothing more.
 *
 * The module reads result summaries for the two models it compares through an injected gateway; the fetch
 * goes over the app's HTTP client, which a module may not import. There is no default. `null` is "no results",
 * a rejection is a failed fetch. The load lives here, outside React; installing the gateway is what starts it.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { ModelVariant } from "@model-builder/core";

/** A model run's result summary — the fields the comparison shows. Units: kWh for the totals, kW for peak demand. */
export interface CompareVariantSummary {
  /** Production over the run, kWh (`sum_production`). */
  sumProduction: number;
  /** Consumption over the run, kWh (`sum_consumption`). */
  sumConsumption: number;
  /** Peak demand over the run, kW (`peak_demand`). */
  peakDemand: number;
}

/** What a host must provide: one model's result summary. Resolve `null` if it has none; reject when the request failed. */
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

/** Install the gateway. Installing is what asks for a recorded pair; passing `null` forgets everything. */
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

/** Ask for both sides of a comparison, on mount and from the installer when a gateway arrives late. Deduplicated per pair. */
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

/** The view's state for a variant, asking for both sides on mount. */
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
