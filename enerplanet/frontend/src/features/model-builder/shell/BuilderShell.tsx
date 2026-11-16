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
 * The layout is a row: the **module column** (workflow bar, the slots, the ledger bar) and, beside it, the
 * **steps panel** — a sibling, not a child, so it keeps its full height while the module area shrinks. That
 * also scopes the overlay to the module column, which is what the spec asks for: an overlay must not cover
 * the chrome you need to get out of it.
 *
 * What the frame owns:
 * - the **workflow bar** and the **ledger bar** (their own components) and the **slots** — `sidebar`, `map`,
 *   `bottom`, `overlay` — composed here, so a module never lays out the page. Each slot is a **bounded box**,
 *   per §4 of the spec: the host gives the box and does *not* scroll a module's content on its behalf. The
 *   module owns its overflow, or its content is clipped — visibly, which is the point: the README calls silent
 *   overflow a bug, and a host that scrolled for the module would be hiding it.
 * - the **session**: one store plus an engine over it, re-seeded whenever the mode changes. Whichever mode it
 *   is, the store is the only state a module has, and what it starts from is what the mode says;
 * - the **gateway and the save**: the bar renders the button, this file does the I/O, because the frame is
 *   what knows which session is on screen;
 * - the **map host**: the canvas from the `map-provider` module (`MAP_PROVIDER`), and the `MapService` it
 *   implements. The map is *always* there — it is not a node and no module's declaration turns it on or off —
 *   so the frame mounts it once and hands its service to whatever module is on screen. Nothing here names a
 *   map library: that is the whole point of the provider.
 *
 * The frame keeps no position of its own: what to show is derived (`frameView`), and so are the bars
 * (`barState`, `ledgerState`), the panel (`stepsState`) and the save's status (`saveModel`). `useStoreVersion`
 * is what tells it the store moved. A broken workflow definition throws rather than rendering an empty frame —
 * it is configuration, and a silent catch would bury a config error.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import type { ModelData } from "@model-builder/core";
import { setGridEngine } from "../modules/grid-generation";
import { setWeatherSource } from "../modules/weather";
import { setRegionSource } from "../modules/model-start";
import { setDemandSource } from "../modules/building-demand";
import { installBuildingConfigurator } from "./buildingConfigurator";
import { setCatalogueSource } from "../modules/technologies";
import { pylovoGridEngine } from "./gridEngine";
import { backendWeatherSource } from "./weatherSource";
import { backendRegionSource } from "./regionSource";
import { pylovoDemandSource } from "./demandSource";
import { backendCatalogueSource } from "./catalogueSource";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { createHttpGateway } from "../save/httpGateway";
import { saveSession } from "./actions";
import { autoRunFor, createAutoGuard } from "./autoRun";
import { useStoreVersion } from "./useStoreVersion";
import { WorkflowBar } from "./WorkflowBar";
import { LedgerBar } from "./LedgerBar";
import { StepsPanel } from "./StepsPanel";
import { MAP_PROVIDER, MODULES, bindModelSaveSession } from "./moduleRegistry";
import { frameView, type FrameMode } from "./frameMode";
import { devWorkflow, type Workflow } from "./workflow";
import { createInvalidator } from "../core/invalidate";
import type { BuilderModule, ModuleViewProps, OverlayControl, Region } from "./contract";

interface Session {
  store: Store;
  engine: Engine;
}

/** The auto node the session is on and where its run stands — what the module that shows it is handed. */
interface AutoStatus {
  id: string;
  state: "running" | "done" | "error";
  message?: string;
}

/** A session over whatever the current mode says the data is: the flow's seed, or a module's test data. */
function sessionFor(workflow: Workflow, seed: Readonly<ModelData>): Session {
  // The store is built **with** the invalidator, once, here — so every seal in this session prunes
  // what the change affects (T7) without each call site having to remember to. A store built
  // without it treats every cascade as empty, which is what the core's own tests rely on.
  const store = createStore(
    // `draftId` is the session's owner before a model exists. The legacy generates it client-side too
    // (`useAreaSelect`), and `BuildingPanelHost` refuses to render without an owner path, so it is seeded here
    // rather than fetched — the same rule `model-start` states for `userId`/`workspaceId`.
    { ...seed, ...(seed.draftId === undefined ? { draftId: crypto.randomUUID() } : {}) },
    { deriveCascade: createInvalidator(workflow.flow, workflow.registry) },
  );
  return { store, engine: createEngine(store) };
}

export const BuilderShell: React.FC = () => {
  const { t } = useTranslation();
  const workflow = useMemo(() => devWorkflow(), []);
  const gateway = useMemo(() => createHttpGateway(), []);
  const moduleIds = useMemo(() => MODULES.map((entry) => entry.module.id), []);
  // Built once for the frame's lifetime: the map host is the frame's, not a module's, and re-creating it would
  // tear the map down and bring it back.
  const host = useMemo(() => MAP_PROVIDER.createHost(), []);

  // The frame's side of the modules' provider slots. A module declares that it *has* an engine or a source and
  // never learns which one; installing them is the host's job, exactly as mounting the map host is. An effect
  // rather than a module-scope side effect, so importing the registry never has side effects of its own.
  useEffect(() => {
    setGridEngine(pylovoGridEngine);
    setWeatherSource(backendWeatherSource);
    setRegionSource(backendRegionSource);
    setDemandSource(pylovoDemandSource);
    // The building configurator's view. Installed here for the same reason as the three above: it needs the
    // legacy's geometry/demand/catalogue machinery, which a module may not import, so the shell supplies it
    // through the module's slot.
    installBuildingConfigurator();
    setCatalogueSource(backendCatalogueSource);
  }, []);
  const map = host.service;
  const [mode, setMode] = useState<FrameMode>({ kind: "workflow" });
  // Workflow mode is the default, so the first session is seeded from the flow.
  const [session, setSession] = useState<Session>(() => sessionFor(workflow, workflow.initial));

  // The save node's session, bound where the session itself lives. It reads the session when it *runs*, so
  // binding at construction would hand it a session that has since been replaced — a mode switch builds a
  // new one. Unbinding on the way out keeps a dead store from outliving its frame. Same shape as the engine
  // above: the module declares the need, the host supplies it, and importing the registry stays side-effect
  // free.
  useEffect(() => {
    bindModelSaveSession({
      gateway,
      store: session.store,
      workflow: workflow.ref,
      flow: workflow.flow,
      registry: workflow.registry,
    });
    return () => bindModelSaveSession(null);
  }, [gateway, session, workflow]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /**
   * The auto node's run state, for the module that shows it (`ModuleViewProps.auto`). The position rests on one
   * auto node at a time, so a single value is enough — keyed by node id, so an entry for the node the session
   * just left cannot leak onto the next one.
   */
  const [autoStatus, setAutoStatus] = useState<AutoStatus | null>(null);
  /**
   * The idempotency guard for the auto run (`autoRun.ts`). A ref, not state: it must survive a re-render and
   * React's StrictMode double-invoke without being a reason to render, and it must be the same object across
   * the two invocations of the effect. Its key is the node id plus the store's change token, so a re-render is
   * not a second run while an input change is.
   */
  const autoGuard = useRef(createAutoGuard());
  const [saveNotice, setSaveNotice] = useState<string | undefined>(undefined);
  const [overlayOpen, setOverlayOpen] = useState(false);
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
   * The bar's save (`spec/frame.md` §6): Call A (the legacy payload) then Call B (the session artefact), with
   * the status pinned to `incomplete`. *Finishing* a model — the real `model.json`, promoted to `draft` so a
   * run accepts it — belongs to the save **node**, behind its completeness gate, not to this button.
   *
   * A refused save sends nothing and says so. A save whose Call B failed still saved the model, and the notice
   * says exactly that rather than pretending the whole thing worked or throwing the model id away.
   */
  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const outcome = await saveSession(gateway, {
        store: session.store,
        flow: workflow.flow,
        registry: workflow.registry,
        workflow: workflow.ref,
      });

      if (!outcome.ok) {
        setSaveNotice(undefined);
        setError(
          t("modelBuilder.save.refused", "nothing was sent: {{reason}}", { reason: outcome.reason }),
        );
        return;
      }

      setError(null);
      setSaveNotice(
        outcome.historySaved
          ? t("modelBuilder.bar.saved", "saved · {{status}}", { status: outcome.status })
          : t("modelBuilder.bar.savedPartial", "model saved, session not"),
      );
    } catch (thrown) {
      setSaveNotice(undefined);
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Move the frame to a mode, re-seeding the session for it. Reset is the same call with the current mode: a
   * fresh session for wherever we already are. It is no longer the only way back to a position that has not
   * run — undo is built now — but it is still how a scratch session is dropped and a node started over.
   */
  const switchTo = (target: FrameMode): void => {
    const next = frameView(target, workflow, MODULES, session.store);
    setMode(target);
    setSession(sessionFor(workflow, next.seed));
    setError(null);
    setSaveNotice(undefined);
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

  /**
   * The panel renders in both branches of the shell — it describes the workflow, which exists whether or not a
   * step is up — but **not in test mode**: there is no position then, and the store on screen is a scratch one
   * with no history, so every step would read "pending" about a session that is not the flow's. That is the
   * same lie the workflow bar refuses to tell when it shows a test-mode chip instead of steps.
   */
  const stepsPanel =
    mode.kind === "test" ? null : (
      <StepsPanel flow={workflow.flow} registry={workflow.registry} store={session.store} />
    );

  /**
   * Run an auto node and reflect it in `autoStatus` — `running` while it is in flight, `done` when it lands,
   * `error` (with the message, and the manual re-run the module then offers) when it throws. `auto` is stamped
   * on the transaction: it is a property of the **node**, not the module (T14).
   */
  const launchAuto = useCallback(
    (nodeId: string, module: BuilderModule["module"]): void => {
      setError(null);
      setAutoStatus({ id: nodeId, state: "running" });
      void session.engine
        .runModule(module, { id: nodeId, auto: true })
        .then(() =>
          setAutoStatus((current) =>
            current?.id === nodeId ? { id: nodeId, state: "done" } : current,
          ),
        )
        .catch((thrown: unknown) => {
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          setError(message);
          setAutoStatus({ id: nodeId, state: "error", message });
        });
    },
    [session.engine],
  );

  /**
   * The auto-run: the session runs the `auto` node it lands on, **once**, and the position advances by itself
   * when the run lands a finished node (position is derived, so a completed node stops being the first that is
   * not done). The guard, keyed by node id + the store's change token, is what makes a re-render — or
   * StrictMode's double-invoke — not a second run, while an input change (a new token) is.
   *
   * It only applies in workflow mode: test mode has no position, so there is nothing to arrive at.
   */
  const storeVersion = session.store.version;
  useEffect(() => {
    if (mode.kind !== "workflow") return;
    const plan = autoRunFor(workflow.flow, workflow.registry, session.store);
    if (plan === undefined) return;
    if (!autoGuard.current.claim(plan)) return;
    launchAuto(plan.id, plan.module);
  }, [launchAuto, mode.kind, session.store, storeVersion, workflow]);

  /** Both branches get the same bar: with no node to show, the session still exists and can still be saved. */
  const bar = (
    <WorkflowBar
      workflow={workflow}
      store={session.store}
      mode={mode}
      moduleIds={moduleIds}
      onModeChange={switchTo}
      onReset={() => switchTo(mode)}
      onSave={save}
      saving={saving}
      saveNotice={saveNotice}
    />
  );

  if (view.entry === undefined) {
    return (
      <div className="flex h-full min-h-0 bg-background">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {bar}

          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <p className="text-sm text-muted-foreground">{t("modelBuilder.shell.noNode")}</p>
          </div>

          <LedgerBar store={session.store} />
        </div>

        {stepsPanel}
      </div>
    );
  }

  const active: BuilderModule = view.entry;
  const View = active.Component;
  const data = session.store.data;
  const inRegion = (region: Region): boolean => active.module.layout.includes(region);

  // The auto node's run state, handed to its render — and only an auto node's. Before the frame's first status
  // lands it reads `running`, which is the honest thing to show between arrival and the effect. `error` is the
  // one state that offers the manual re-run, and it re-runs the node on screen.
  const here = autoStatus !== null && autoStatus.id === view.nodeId ? autoStatus : undefined;
  const auto: ModuleViewProps["auto"] =
    view.auto !== true
      ? undefined
      : {
          state: here?.state ?? "running",
          ...(here?.message === undefined ? {} : { message: here.message }),
          rerun: () => launchAuto(view.nodeId ?? "", active.module),
        };

  // One props object per render, built from the declaration: `map` and `overlay` are present only when the
  // module actually declared that region — which is what the contract promises.
  const viewProps = (region: Region): ModuleViewProps => ({
    nodeId: view.labelId,
    region,
    data,
    run,
    ...(inRegion("map") ? { map } : {}),
    ...(inRegion("overlay") ? { overlay } : {}),
    ...(auto === undefined ? {} : { auto }),
  });

  return (
    <div className="flex h-full min-h-0 bg-background">
      {/* The module column: everything the module's declaration composes, plus the frame's own bars. */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {bar}

        <div className="flex min-h-0 flex-1">
          {/* Bounded box: up to ⅓ of the content area (never narrower than 20rem). The module owns what
              happens inside it. */}
          {inRegion("sidebar") && (
            <aside className="w-1/3 min-w-[20rem] shrink-0 overflow-hidden border-r border-border bg-card p-6">
              <View {...viewProps("sidebar")} />
            </aside>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            {/* The map is always here — the host fills the box, and a module's `map` region layers its
                controls on top. That layer is **pass-through**, so a module's panel never swallows a map
                click by accident; a control that wants clicks opts in with `pointer-events-auto`. */}
            <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/30">
              <div className="absolute inset-0">
                <host.Canvas />
              </div>

              {inRegion("map") && (
                <div className="pointer-events-none relative z-10 min-h-0 flex-1 overflow-hidden p-6">
                  <View {...viewProps("map")} />
                </div>
              )}
            </section>

            {/* Bounded box: intrinsic height, capped at ¼ of the content area — a cap, not a quota. */}
            {inRegion("bottom") && (
              <footer className="max-h-[25%] shrink-0 overflow-hidden border-t border-border bg-card px-6 py-3">
                <View {...viewProps("bottom")} />
              </footer>
            )}
          </div>
        </div>

        <LedgerBar store={session.store} />

        {/* Scoped to the module column — the chrome you need to leave it is never covered. An **auto** node
            forces this slot open: it is where the node shows its own run state, since it has no forward action
            to press (`autoRun.ts`). An auto node gets the slot *full-bleed* — a loading indicator that takes the
            screen — while a module-opened overlay (a click) keeps the host's centred card. */}
        {inRegion("overlay") &&
          (overlayOpen || view.auto === true) &&
          (view.auto === true ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm">
              <View {...viewProps("overlay")} />
            </div>
          ) : (
            <div className="absolute inset-0 z-40 flex items-start justify-center bg-background/80 p-6 backdrop-blur-sm">
              <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card p-6 shadow-lg">
                <View {...viewProps("overlay")} />
              </div>
            </div>
          ))}

        {error !== null && (
          <div className="relative z-50 shrink-0 border-t border-destructive/40 bg-destructive/10 px-6 py-2 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      {stepsPanel}
    </div>
  );
};

export default BuilderShell;
