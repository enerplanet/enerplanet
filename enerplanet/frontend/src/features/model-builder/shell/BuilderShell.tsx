/**
 * The Model Builder frame (`Plan.md` §8, `spec/frame.md`) — the host a module mounts into.
 *
 * The frame runs in one of two **modes** (`frameMode.ts`), and everything else follows from which:
 *
 * - **workflow** — the session starts from the workflow's seed, the module on screen is the node the session
 *   sits on, and running it advances the position. This is the real thing.
 * - **test mode** — one module on its own, seeded from its own test data, with no workflow and no position.
 *   This is how a module is developed and *seen* before it is placed in anything, and it is why the frame
 *   needs a mode at all rather than always following the flow.
 *
 * What the frame owns:
 * - the **workflow bar** (its own component) and the **slots** — `sidebar`, `map`, `bottom`, `overlay` —
 *   composed here, so a module never lays out the page;
 * - the **session**: one store plus an engine over it, re-seeded whenever the mode changes. Whichever mode it
 *   is, the store is the only state a module has, and what it starts from is what the mode says;
 * - the **map host** (stub): a `MapService` plus the plain statement that no baselayer *provider* module is
 *   loaded yet. The provider is swappable by design, which is why nothing here names a map library.
 *
 * The frame keeps no position of its own: what to show is derived (`frameView`), and so is the bar
 * (`barState`). `useStoreVersion` is what tells it the store moved. A broken workflow definition throws
 * rather than rendering an empty frame — it is configuration, and a silent catch would bury a config error.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import type { ModelData } from "@model-builder/core";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { useStoreVersion } from "./useStoreVersion";
import { WorkflowBar } from "./WorkflowBar";
import { LedgerBar } from "./LedgerBar";
import { MODULES } from "./moduleRegistry";
import { frameView, type FrameMode } from "./frameMode";
import { devWorkflow } from "./workflow";
import type { BuilderModule, MapService, ModuleViewProps, OverlayControl, Region } from "./contract";

interface Session {
  store: Store;
  engine: Engine;
}

/** A session over whatever the current mode says the data is: the flow's seed, or a module's test data. */
function sessionFor(seed: Readonly<ModelData>): Session {
  const store = createStore({ ...seed });
  return { store, engine: createEngine(store) };
}

/**
 * The map host's stub. It records the layers a module adds — enough to prove the seam and to see a module's
 * layers appear — and says plainly that no baselayer provider is loaded yet.
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
  const workflow = useMemo(() => devWorkflow(), []);
  const moduleIds = useMemo(() => MODULES.map((entry) => entry.module.id), []);
  const [mode, setMode] = useState<FrameMode>({ kind: "workflow" });
  // Workflow mode is the default, so the first session is seeded from the flow.
  const [session, setSession] = useState<Session>(() => sessionFor(workflow.initial));
  const [error, setError] = useState<string | null>(null);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { map, layers } = useMapStub();
  // The frame reads the store; the store tells it when it changed — a seal, an undo, a redo.
  useStoreVersion(session.store);

  // What the mode says to show, and what a session should start from. The seed is taken from here rather than
  // from the mode branch directly, so "which module" and "which data" cannot disagree.
  const view = frameView(mode, workflow, MODULES, session.store);

  const run = async (): Promise<void> => {
    const entry = view.entry;
    if (entry === undefined) return;
    try {
      // In a workflow the transaction is stamped with the *node* id — history names positions, and a module
      // can be placed more than once. In test mode there is no position, so nothing is stamped.
      await session.engine.runModule(
        entry.module,
        view.nodeId === undefined ? undefined : { id: view.nodeId },
      );
      setError(null);
    } catch (thrown) {
      // A rejected write, a missing required port, a save refusal: all of them mean nothing was sealed, and
      // all of them are exactly what a module developer needs to see.
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    }
  };

  /**
   * Move the frame to a mode, re-seeding the session for it. Reset is the same call with the current mode: a
   * fresh session for wherever we already are. Dev-only until undo exists, since it is the only way back to a
   * position that has not run.
   */
  const switchTo = (target: FrameMode): void => {
    const next = frameView(target, workflow, MODULES, session.store);
    setMode(target);
    setSession(sessionFor(next.seed));
    setError(null);
    setOverlayOpen(false);
  };

  // The overlay slot's open/closed state lives here, not in a module: the host owns the chrome — the scrim,
  // the centring, the Escape handling — and a module asks for it through `OverlayControl`. Like the map, this
  // is transient *view* state: nothing about it is committed to the store.
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

  if (view.entry === undefined) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <WorkflowBar
          workflow={workflow}
          store={session.store}
          mode={mode}
          moduleIds={moduleIds}
          onModeChange={switchTo}
          onReset={() => switchTo(mode)}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">{t("modelBuilder.shell.noNode")}</p>
        </div>

        <LedgerBar store={session.store} />
      </div>
    );
  }

  const active: BuilderModule = view.entry;
  const View = active.Component;
  const data = session.store.data;
  const inRegion = (region: Region): boolean => active.module.layout.includes(region);

  // One props object per render, built from the declaration: `map` and `overlay` are present only when the
  // module actually declared that region — which is what the contract promises.
  const viewProps = (region: Region): ModuleViewProps => ({
    nodeId: view.labelId,
    region,
    data,
    run,
    ...(inRegion("map") ? { map } : {}),
    ...(inRegion("overlay") ? { overlay } : {}),
  });

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <WorkflowBar
        workflow={workflow}
        store={session.store}
        mode={mode}
        moduleIds={moduleIds}
        onModeChange={switchTo}
        onReset={() => switchTo(mode)}
      />

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

      <LedgerBar store={session.store} />

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
