/**
 * The region slot — what `model-start` needs from a host, and nothing more.
 *
 * The module declares that it *can* offer regions and never learns where they come from; a host installs the
 * implementation at startup, the same shape as the grid engine and the weather source. That is what keeps this
 * module free of the app's HTTP client, and what lets its tests run against a fake.
 *
 * **The list lives here, outside React.** A module's `Component` renders once per region it declares — this
 * one declares two (`sidebar`, `map`) — so a value both regions need cannot sit in component state: each
 * instance would fetch its own copy and they would disagree. One load, one list, every region subscribes —
 * the same reason `area-draw` keeps its draft in `draft.ts`.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { RegionRef } from "@model-builder/core";

/** One region a model can be drawn in. */
export interface RegionOption {
  country: string;
  state: string;
  label: string;
  /** `[west, south, east, north]` — enough to frame the region on the map. */
  bounds: [number, number, number, number];
}

/** What a host must provide for this module to offer regions. */
export interface RegionSource {
  /** The regions a model may be drawn in. Rejects when the backend cannot answer. */
  listRegions(): Promise<readonly RegionOption[]>;
}

/** What the picker knows right now. */
export interface RegionsState {
  regions: readonly RegionOption[];
  /** True until the first answer lands: the picker cannot say "no regions" before it has asked. */
  loading: boolean;
  /** True when the load itself failed — a different claim from an empty list. */
  failed: boolean;
}

let source: RegionSource | null = null;
let state: RegionsState = { regions: [], loading: false, failed: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: RegionsState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Install the source. The frame calls this at startup, the way it installs the grid engine. */
export function setRegionSource(next: RegionSource | null): void {
  source = next;
  // A new source may answer differently, so what the old one returned is no longer ours to show.
  inFlight = null;
  publish({ regions: [], loading: next !== null, failed: false });
}

/**
 * Load the list, once per source.
 *
 * Deduplicated because both regions mount together: without this, opening the node would ask the backend
 * twice for the same list. A loaded list is never fetched again here — the caching and re-asking a failed
 * answer belong to the shell (`regionSource.ts`), which mirrors the legacy's own time-boxed cache.
 */
export function loadRegions(): Promise<void> {
  if (!state.loading) return Promise.resolve();
  if (inFlight !== null) return inFlight;

  const installed = source;
  if (installed === null) {
    publish({ regions: [], loading: false, failed: false });
    return Promise.resolve();
  }

  inFlight = installed
    .listRegions()
    .then((regions) => publish({ regions, loading: false, failed: false }))
    .catch(() => publish({ regions: [], loading: false, failed: true }))
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Subscribe to the picker's state — the shape `useSyncExternalStore` wants, exported so it can be tested. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The picker's state right now. */
export function regionsState(): RegionsState {
  return state;
}

/** The picker's state, shared by every region, loading the list on first mount. */
export function useRegions(): RegionsState {
  const snapshot = useSyncExternalStore(subscribe, regionsState);
  // Whichever region mounts first starts the one load; the other joins it through `inFlight`.
  useEffect(() => {
    void loadRegions();
  }, []);
  return snapshot;
}

/** The `<country>-<state>` key a region is identified by — the two fields the port carries. */
export function regionKey(region: { country: string; state: string }): string {
  return `${region.country}-${region.state}`;
}

/** The option for a stored region, if the source still offers it. */
export function optionFor(
  regions: readonly RegionOption[],
  ref: RegionRef | undefined,
): RegionOption | undefined {
  if (ref === undefined) return undefined;
  return regions.find((candidate) => candidate.country === ref.country && candidate.state === ref.state);
}

/**
 * The options the picker offers: the loaded regions, plus the stored region when the source no longer lists
 * it. A model whose region has left the list still belongs to that region — omitting it would make the choice
 * read as unset, a lie about a value the store holds. The stand-in carries no real bounds: the map frames only
 * what the source listed, so it is for display, never for framing.
 */
export function optionsFor(
  regions: readonly RegionOption[],
  stored: RegionRef | undefined,
): readonly RegionOption[] {
  if (stored === undefined || optionFor(regions, stored) !== undefined) return regions;
  return [
    ...regions,
    { country: stored.country, state: stored.state, label: regionKey(stored), bounds: [0, 0, 0, 0] },
  ];
}
