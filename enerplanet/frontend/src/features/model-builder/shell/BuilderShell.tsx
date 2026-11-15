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

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import type { ModelData } from "@model-builder/core";
import { setGridEngine } from "../modules/grid-generation";
import { pylovoGridEngine } from "./gridEngine";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { createHttpGateway } from "../save/httpGateway";
import { saveSession } from "./actions";
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

/** A session over whatever the current mode says the data is: the flow's seed, or a module's test data. */
function sessionFor(workflow: Workflow, seed: Readonly<ModelData>): Session {
  // The store is built **with** the invalidator, once, here — so every seal in this session prunes
  // what the change affects (T7) without each call site having to remember to. A store built
  // without it treats every cascade as empty, which is what the core's own tests rely on.
  const store = createStore(
    { ...seed },
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

  // The frame's side of a module's provider slot. `grid-generation` declares that it *has* a grid engine and
  // never learns which one; installing it is the host's job, exactly as mounting the map host is. An effect
  // rather than a module-scope side effect, so importing the registry never has side effects of its own.
  useEffect(() => {
    setGridEngine(pylovoGridEngine);
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

        {/* Scoped to the module column — the chrome you need to leave it is never covered. */}
        {inRegion("overlay") && overlayOpen && (
          <div className="absolute inset-0 z-40 flex items-start justify-center bg-background/80 p-6 backdrop-blur-sm">
            <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-card p-6 shadow-lg">
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

      {stepsPanel}
    </div>
  );
};

export default BuilderShell;
