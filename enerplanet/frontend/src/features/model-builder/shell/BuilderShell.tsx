/**
 * The Model Builder shell (`Plan.md` §8) — the frame modules mount into.
 *
 * This is the **prototyping** shell: it hosts one module at a time, from the manual registry, on a
 * scratch store seeded with that module's mock data. That is what lets modules be built one at a
 * time and in isolation, before any workflow exists; linking them into a flow comes later, and the
 * region frame below is the part that survives that change.
 *
 * What the shell owns:
 * - the **regions** (`sidebar`, `map`, `bottom`, `overlay`) and how the page is composed — a module
 *   only names the regions it wants, it never lays out the page;
 * - the **scratch session** — one store per active module, seeded from its `mock`, reset on switch.
 *   The store is not reactive, so a commit is followed by a nudge (`setRevision`) to re-render;
 * - the **map host** (stub): a `MapService` plus the plain statement that no baselayer *provider*
 *   module is loaded yet. The provider is swappable by design, which is why nothing here names a map
 *   library.
 *
 * Known gap, deliberate: a module that declares `overlay` gets it rendered. Real full-screen views
 * need a visibility signal from the module (or the node's state) — worth deciding when the first
 * module actually needs an overlay, rather than inventing the mechanism now.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { MODULES } from "./moduleRegistry";
import { useStoreVersion } from "./useStoreVersion";
import type { BuilderModule, MapService, ModuleViewProps, OverlayControl, Region } from "./contract";

interface Session {
  store: Store;
  engine: Engine;
}

/** A scratch session for isolated development: the module's mock data is the seed. */
function sessionFor(entry: BuilderModule): Session {
  const store = createStore({ ...(entry.mock ?? {}) });
  return { store, engine: createEngine(store) };
}

/**
 * The map host's stub. It records the layers a module adds — enough to prove the seam and to see a
 * module's layers appear — and says plainly that no baselayer provider is loaded yet.
 */
function useMapStub(): { map: MapService; layers: readonly string[] } {
  const [layers, setLayers] = useState<readonly string[]>([]);

  const map = useMemo<MapService>(
    () => ({
      addLayer: (id) => setLayers((current) => (current.includes(id) ? current : [...current, id])),
      removeLayer: (id) => setLayers((current) => current.filter((existing) => existing !== id)),
      fitTo: () => undefined,
      requestPoint: () => Promise.reject(new Error("no baselayer provider module is loaded")),
      requestPolygon: () => Promise.reject(new Error("no baselayer provider module is loaded")),
    }),
    [],
  );

  return { map, layers };
}

export const BuilderShell: React.FC = () => {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>(MODULES[0]?.module.id ?? "");
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { map, layers } = useMapStub();
  // The frame reads the store; the store tells it when it changed, so no nudge is needed at the call
  // sites that used to poke a revision counter by hand.
  useStoreVersion(session?.store);

  const active = MODULES.find((entry) => entry.module.id === activeId);

  // Switching modules starts a fresh scratch session — a module is developed against its own inputs.
  useEffect(() => {
    const entry = MODULES.find((candidate) => candidate.module.id === activeId);
    setSession(entry ? sessionFor(entry) : null);
    setError(null);
    setOverlayOpen(false);
  }, [activeId]);

  const run = async (): Promise<void> => {
    if (active === undefined || session === null) return;
    try {
      await session.engine.runModule(active.module, { id: active.module.id });
      setError(null);
    } catch (thrown) {
      // A rejected write, a missing required port, a save refusal: all of them mean nothing was
      // sealed, and all of them are exactly what a module developer needs to see.
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  // The overlay slot's open/closed state lives here, not in a module: the host owns the chrome — the
  // scrim, the centring, the Escape handling — and a module asks for it through `OverlayControl`. Like
  // the map, this is transient *view* state: nothing about it is committed to the store.
  const overlay = useMemo<OverlayControl>(
    () => ({
      get isOpen(): boolean {
        return overlayOpen;
      },
      open: () => setOverlayOpen(true),
      close: () => setOverlayOpen(false),
    }),
    [overlayOpen],
  );

  // A full-screen slot needs a way out that is not a mouse hunt.
  useEffect(() => {
    if (!overlayOpen) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlayOpen]);

  if (active === undefined || session === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t("modelBuilder.shell.noModules")}</p>
      </div>
    );
  }

  const View = active.Component;
  const data = session.store.data;
  const inRegion = (region: Region): boolean => active.module.layout.includes(region);

  // One props object per render, built from the declaration: `map` and `overlay` are present only when
  // the module actually declared that region — which is what the contract promises.
  const viewProps = (region: Region): ModuleViewProps => ({
    nodeId: active.module.id,
    region,
    data,
    run,
    ...(inRegion("map") ? { map } : {}),
    ...(inRegion("overlay") ? { overlay } : {}),
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold">{t("modelBuilder.shell.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("modelBuilder.shell.subtitle")}</p>
        </div>

        <div className="flex items-center gap-2">
          {import.meta.env.DEV && (
            <>
              <label className="text-sm text-muted-foreground" htmlFor="builder-module">
                {t("modelBuilder.shell.module")}
              </label>
              <select
                id="builder-module"
                value={activeId}
                onChange={(event) => setActiveId(event.target.value)}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
              >
                {MODULES.map((entry) => (
                  <option key={entry.module.id} value={entry.module.id}>
                    {entry.module.id}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setSession(sessionFor(active));
              setError(null);
              setOverlayOpen(false);
            }}
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {t("modelBuilder.shell.reset")}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {inRegion("sidebar") && (
          <aside className="w-80 shrink-0 overflow-auto border-r border-border bg-card p-6">
            <View {...viewProps("sidebar")} />
          </aside>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {inRegion("map") && (
            <section className="min-h-0 flex-1 overflow-auto bg-muted/30 p-6">
              <p className="text-sm text-muted-foreground">{t("modelBuilder.shell.noMap")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("modelBuilder.shell.layers", "Layers added: {{count}}", {
                  count: layers.length,
                })}
              </p>
              <div className="mt-4">
                <View {...viewProps("map")} />
              </div>
            </section>
          )}

          {inRegion("bottom") && (
            <footer className="shrink-0 border-t border-border bg-card px-6 py-3">
              <View {...viewProps("bottom")} />
            </footer>
          )}
        </div>
      </div>

      {inRegion("overlay") && overlayOpen && (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-background/80 p-6 backdrop-blur-sm">
          <div className="max-h-full w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-6 shadow-lg">
            <View {...viewProps("overlay")} />
          </div>
        </div>
      )}

      {error !== null && (
        <div className="relative z-50 shrink-0 border-t border-destructive/40 bg-destructive/10 px-6 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
};

export default BuilderShell;
