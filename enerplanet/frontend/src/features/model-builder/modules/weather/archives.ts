/**
 * The weather archive slot — what `weather` needs from a host, and nothing more.
 *
 * The module declares that it *can* offer archives and never learns where they come from; a host installs the
 * implementation at startup, the same shape as the grid engine and the region slot. That is what keeps this
 * module free of the app's HTTP client, and what lets its tests run against a fake.
 *
 * **The list lives here, outside React**, for the same reason `model-start`'s regions do: a load has to be
 * startable from the install, not only from a component's mount, or it is never started at all (see
 * `setWeatherSource`).
 */

import { useEffect, useSyncExternalStore } from "react";

/** What the backend says about its weather archives. */
export interface WeatherArchives {
  /** The archive runs use when a model chooses none; null until known. */
  defaultProvider: string | null;
  /** Archives with at least one year, each ascending. */
  archives: Record<string, number[]>;
}

/**
 * What this module needs from a host: the archives it may choose from.
 *
 * One method, and deliberately not a year-by-archive lookup: the choice is *stored*, never fetched, and the
 * years are here only so the picker is honest about what the backend can actually serve.
 */
export interface WeatherSource {
  listArchives(): Promise<WeatherArchives>;
}

/** What the picker knows right now. */
export interface ArchivesState {
  archives: WeatherArchives;
  /** True until the first answer lands: the picker cannot say "no archives" before it has asked. */
  loading: boolean;
  /** True when the load itself failed — a different claim from an empty archive list. */
  failed: boolean;
}

/** The empty list the picker opens with, and the one a failed load falls back to. */
const NO_ARCHIVES: WeatherArchives = { defaultProvider: null, archives: {} };

let source: WeatherSource | null = null;
let state: ArchivesState = { archives: NO_ARCHIVES, loading: false, failed: false };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ArchivesState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Install the source. The frame calls this at startup, the way it installs the grid engine. */
export function setWeatherSource(next: WeatherSource | null): void {
  source = next;
  // A new source may answer differently, so what the old one returned is no longer ours to show.
  inFlight = null;
  publish({ archives: NO_ARCHIVES, loading: next !== null, failed: false });

  // **Installing a source is what asks for the archives.** The panel mounts before the shell's install effect
  // runs — React runs child effects first — so the mount-time load in `useArchives` finds no source and bails,
  // and nothing would ever ask again. Without this the picker sits on "loading" and the request is never made.
  if (next !== null) void loadArchives();
}

/**
 * Load the archives, once per source.
 *
 * Deduplicated while a load is in flight, and a no-op once one has landed: `loading` is the flag that says a
 * load is owed. `setWeatherSource` raises it and starts the load, the answer lowers it — so a panel that
 * mounts later joins the running load instead of asking again.
 */
export function loadArchives(): Promise<void> {
  if (!state.loading) return Promise.resolve();
  if (inFlight !== null) return inFlight;

  const installed = source;
  if (installed === null) {
    publish({ archives: NO_ARCHIVES, loading: false, failed: false });
    return Promise.resolve();
  }

  inFlight = installed
    .listArchives()
    .then((archives) => publish({ archives, loading: false, failed: false }))
    .catch(() => publish({ archives: NO_ARCHIVES, loading: false, failed: true }))
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
export function archivesState(): ArchivesState {
  return state;
}

/** The picker's state, loading the archives on first mount. */
export function useArchives(): ArchivesState {
  const snapshot = useSyncExternalStore(subscribe, archivesState);
  useEffect(() => {
    void loadArchives();
  }, []);
  return snapshot;
}
