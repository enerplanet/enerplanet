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
 * is what tells it the store moved.
 *
 * The component is split in two, and the split is the point: `BuilderShell` fetches the default workflow and
 * `BuilderFrame` runs it. The flow is a database row now (`plan §6`, Stage 2), so it does not exist when the
 * frame would first render — the frame must not mount until it has arrived. A failed fetch, a missing default,
 * and a stored document naming an unknown module are all **data conditions**, reported in the frame's own
 * style rather than thrown: `toWorkflow`'s refusal is right for the developer-authored definition it was
 * written against, but a row is user data, and a white screen is not a report (`plan §3`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "@spatialhub/i18n";
import type { ModelData } from "@model-builder/core";
import { setGridEngine } from "../modules/grid-generation";
import { setWeatherSource } from "../modules/weather";
import { setRegionSource } from "../modules/model-start";
import { setDemandSource } from "../modules/building-demand";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
import { useAuthStore } from "@/store/auth-store";
import { BuildingPreparation, installBuildingConfigurator } from "./buildingConfigurator";
import { installMemeRunGateway } from "./memeRunGateway";
import { installMemePypsaLegGateway } from "./memePypsaLegGateway";
import { installResultOverviewGateway } from "./resultOverviewGateway";
import { installModelVariantGateway } from "./modelVariantGateway";
import { installCompareVariantGateway } from "./compareVariantGateway";
import { setCatalogueSource } from "../modules/technologies";
import { pylovoGridEngine } from "./gridEngine";
import { backendWeatherSource } from "./weatherSource";
import { backendRegionSource } from "./regionSource";
import { pylovoDemandSource } from "./demandSource";
import { backendCatalogueSource } from "./catalogueSource";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import { createHttpGateway } from "../save/httpGateway";
import { loadSession } from "../load/loader";
import { moveToNode, saveSession } from "./actions";
import { autoRunFor, createAutoGuard } from "./autoRun";
import { createVariantSessionGuard, persistVariantSession } from "./variantSession";
import { useStoreVersion } from "./useStoreVersion";
import { WorkflowBar } from "./WorkflowBar";
import { LedgerBar } from "./LedgerBar";
import { StepsPanel } from "./StepsPanel";
import { MAP_PROVIDER, MODULES, bindModelSaveSession } from "./moduleRegistry";
import { frameView, type FrameMode } from "./frameMode";
import { loadDefaultWorkflow, type Workflow } from "./workflow";
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

/**
 * The session's identity: which workspace a model is created in, and who made it.
 *
 * It is not something the form collects — `model-start` declares both ports and never writes them, and
 * `saveNode` says the same — so the host has to put them in the store. The legacy reads them at save time
 * (`useWorkspaceStore`'s `currentWorkspace`, `useAuthStore`'s `user`); this is the same rule, applied once
 * when a session starts.
 *
 * It matters beyond bookkeeping: the dashboard lists models *within a workspace*
 * (`useModelsQuery`'s `requireWorkspace`), so a model created without one is a model the user cannot find —
 * saved, correct, and invisible.
 */
export interface SessionIdentity {
  workspaceId?: number;
  userId?: string;
}

/** A session over whatever the current mode says the data is: the flow's seed, or a module's test data. */
function sessionFor(workflow: Workflow, seed: Readonly<ModelData>, identity: SessionIdentity): Session {
  // The store is built **with** the invalidator, once, here — so every seal in this session prunes
  // what the change affects (T7) without each call site having to remember to. A store built
  // without it treats every cascade as empty, which is what the core's own tests rely on.
  const store = createStore(
    // The identity is a *fallback* under the seed, not an override: a loaded artefact carries the identity its
    // model was actually created with, and that is what its session should keep.
    //
    // `draftId` is the session's owner before a model exists. The legacy generates it client-side too
    // (`useAreaSelect`), and `BuildingPanelHost` refuses to render without an owner path, so it is seeded here
    // rather than fetched — the same rule `model-start` states for `userId`/`workspaceId`.
    {
      ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
      ...(identity.userId === undefined ? {} : { userId: identity.userId }),
      ...seed,
      ...(seed.draftId === undefined ? { draftId: crypto.randomUUID() } : {}),
    },
    { deriveCascade: createInvalidator(workflow.flow, workflow.registry) },
  );
  return { store, engine: createEngine(store) };
}

/**
 * Resolve once a React commit has been made, its effects have run, and the browser has painted it.
 *
 * This is load bearing rather than polite: it is the gap a module's effects need before the frame moves the
 * session on to another node — a draw that reads what a run just produced has to happen while the module that
 * produced it is still mounted.
 *
 * Both the frame and the timeout, deliberately. An animation frame is the right moment (it runs after passive
 * effects, before paint), but **a hidden or backgrounded tab never fires one** — and a release that can hang
 * would pin the frame to a node the session has already left, which is a worse bug than the one this fixes. The
 * timeout is the way out when no frame comes.
 */
const nextPaint = (): Promise<void> =>
  new Promise((resolve) => {
    const fallback = setTimeout(resolve, 120);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolve();
    });
  });

/** The frame proper: everything a builder does once its workflow has arrived. It never learns how it landed. */
const BuilderFrame: React.FC<{ workflow: Workflow }> = ({ workflow }) => {
  const { t } = useTranslation();
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
    // The MEME-run gateway: the run dispatches to the backend's own model endpoints, which a module may not
    // reach, so the shell supplies it through the module's slot.
    installMemeRunGateway();
    // The PyPSA-leg gateway: the power flow dispatches to the backend's own model endpoints, which a module
    // may not reach, so the shell supplies it through the module's slot.
    installMemePypsaLegGateway();
    // The results-overview gateway: the results summary reads the backend's structured-results endpoint,
    // which a module may not reach, so the shell supplies it through the module's slot.
    installResultOverviewGateway();
    // The model-variant gateway: the family copy is created through the backend's own model endpoints, which
    // a module may not reach, so the shell supplies it through the module's slot.
    installModelVariantGateway();
    // The compare-variant gateway: both sides' result summaries read the backend's structured-results
    // endpoint, which a module may not reach, so the shell supplies it through the module's slot.
    installCompareVariantGateway();
  }, []);
  const map = host.service;
  const [mode, setMode] = useState<FrameMode>({ kind: "workflow" });

  // The workspace a model is created in, and who made it. Read here, once, because a module cannot reach app
  // state: the identity travels to the save as an ordinary port, seeded into the session the way `draftId` is.
  // Without it the model is created with a null workspace — and the dashboard, which lists models *within* a
  // workspace, cannot show it. See `SessionIdentity`.
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspace?.id);
  const userId = useAuthStore((state) => state.user?.id);
  const identity = useMemo<SessionIdentity>(
    () => ({
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(userId === undefined ? {} : { userId: String(userId) }),
    }),
    [workspaceId, userId],
  );

  // Workflow mode is the default, so the first session is seeded from the flow.
  const [session, setSession] = useState<Session>(() => sessionFor(workflow, workflow.initial, identity));

  /**
   * The node a run is holding the view on: set while that run is in flight, cleared once its effects have landed.
   *
   * Without it a run moves the frame in the same React commit that delivers its outputs — the position is derived,
   * and a done node is behind the cursor — so the module unmounts before its own effects run. A module that draws
   * from what it just produced (the grid generator, above all) then never draws, while the store holds a grid that
   * nothing put on the map. **The module's run moves the session on**, not the store write; this is what gives it
   * the moment to finish being on screen.
   */
  const [held, setHeld] = useState<string | undefined>(undefined);

  // ── the load: `?model=<id>`, the way the dashboard hands a model over ──────────────────────────────
  //
  // A loaded session *replaces* the one on screen rather than seeding it: the artefact is a store's whole
  // history, so the position, the undo tail and the data all come from it, and the frame derives where to
  // stand (`frameView`) from the log it arrives with. Nothing navigational is decided here.
  //
  // The dashboard's button is what points at this, and the parameter name is the contract between the two.
  const [search] = useSearchParams();
  const requestedModel = search.get("model");
  /**
   * The request that has already been claimed — a load must not run again on every render.
   *
   * A **ref**, deliberately, and the difference is the whole bug. As state, claiming the request re-rendered
   * the shell; the claim was then in the effect's dependencies, so React tore the effect down and ran its
   * cleanup — which set `cancelled` — and the answer that arrived a moment later was thrown away by the guard.
   * The load fetched, succeeded, and changed nothing: every node read as untouched, because the frame was
   * still looking at the flow's seed. A ref cannot cause either half of that: no re-render, no re-run.
   */
  const claimed = useRef<string | null>(null);
  const [loading, setLoading] = useState(requestedModel !== null);

  useEffect(() => {
    if (requestedModel === null || claimed.current === requestedModel) return;
    // Claimed before the await, so a re-render between the request and its answer starts nothing new.
    claimed.current = requestedModel;
    setLoading(true);

    const modelId = Number(requestedModel);
    if (!Number.isFinite(modelId)) {
      setError(t("modelBuilder.shell.badModelId", "That model id is not a number."));
      setLoading(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const outcome = await loadSession({
          gateway,
          modelId,
          flow: workflow.flow,
          registry: workflow.registry,
        });
        if (cancelled) return;

        if (outcome.kind === "none") {
          // A model that exists but was never saved from the builder: a legacy model, or one whose save
          // failed before the session was written. Saying so beats an empty builder that looks broken.
          setError(t("modelBuilder.shell.noSession", "This model has no experimental session to load."));
          return;
        }

        setSession({ store: outcome.session.store, engine: createEngine(outcome.session.store) });
        setError(null);
        // The artefact check's verdict, when it had one: the stored projection disagreed with its own log,
        // so the log was replayed. Nothing is repaired in place — this is what the user is owed for that.
        if (outcome.session.divergence !== undefined) {
          setError(
            t(
              "modelBuilder.shell.divergence",
              "This model's saved state disagreed with its history; it was rebuilt from the history instead.",
            ),
          );
        }
      } catch (thrown) {
        if (cancelled) return;
        setError(thrown instanceof Error ? thrown.message : String(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedModel, gateway, workflow, t]);

  /**
   * A dev aid, not a feature — the same kind the map host exposes (`__mbMap`).
   *
   * "The node says a port is not set" has two causes that look identical on screen: the session on display is
   * the flow's seed rather than the loaded model, or the loaded store genuinely lacks the port. The seeds differ
   * in exactly the way that tells them apart, so this exposes which one is on screen.
   *
   * In the console: `Object.keys(__mbSession.store.data)` — 21 keys and `modelId` present means the load
   * landed; one or two keys means the seed is still there.
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as { __mbSession?: unknown }).__mbSession = session;
  }, [session]);

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
      // Rebound when the identity changes, so a workspace that loads after the session was created still
      // reaches the save as a live value rather than whatever the seed happened to know at mount.
      ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
      ...(identity.userId === undefined ? {} : { userId: identity.userId }),
    });
    return () => bindModelSaveSession(null);
  }, [gateway, session, workflow, identity]);
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
  /**
   * The fork's own session, owed once (`variantSession.ts`). A ref for the same reasons `autoGuard` is one: it
   * must survive a re-render and StrictMode's double-invoke without being a reason to render, and the same guard
   * object must see both invocations. It claims a fork the first time `modelVariant` appears on the session's
   * store, and adopts whatever a freshly-adopted session already carries — a load or a reset owes no row.
   */
  const variantGuard = useRef(createVariantSessionGuard());
  const [saveNotice, setSaveNotice] = useState<string | undefined>(undefined);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // The frame reads the store; the store tells it when it changed — a seal, an undo, a redo.
  useStoreVersion(session.store);

  // What the mode says to show, and what a session should start from. The seed is taken from here rather than
  // from the mode branch directly, so "which module" and "which data" cannot disagree.
  const view = frameView(mode, workflow, MODULES, session.store, held);

  const run = async (): Promise<void> => {
    const entry = view.entry;
    if (entry === undefined) return;
    const at = view.nodeId;
    try {
      if (at !== undefined) setHeld(at);
      // In a workflow the transaction is stamped with the *node* id — history names positions, and a module
      // can be placed more than once. In test mode there is no position, so nothing is stamped.
      await session.engine.runModule(entry.module, at === undefined ? undefined : { id: at });
      setError(null);
    } catch (thrown) {
      // A rejected write, a missing required port, a save refusal: all of them mean nothing was sealed, and
      // all of them are exactly what a module developer needs to see.
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      // Two frames: one for React to commit the run's writes and run the effects that read them, one to be sure
      // that commit has been painted. Only then does the derived position take over — the session ends up on the
      // node after this one, which is where the user was heading when they pressed the button.
      await nextPaint();
      setHeld(undefined);
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
        // The bar's save creates the model too, so it needs the same live identity the node's does.
        ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
        ...(identity.userId === undefined ? {} : { userId: identity.userId }),
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
    setHeld(undefined);
    setSession(sessionFor(workflow, next.seed, identity));
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
      <StepsPanel
        flow={workflow.flow}
        registry={workflow.registry}
        store={session.store}
        // The same primitive the bar's prior control calls: a pure position move that discards nothing, so a
        // click here cannot invalidate anything. It refuses a forward target, which is why `stepsState` only
        // marks steps *behind* the session as moveable — the panel offers exactly what the core will do.
        onMove={(nodeId) => moveToNode(workflow.flow, workflow.registry, session.store, nodeId)}
      />
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

  /**
   * The fork's own session (`variantSession.ts`, `plan` D2). Committing `modelId` **is** the switch — the frame
   * renders the one store and no page is navigated — but the copy is a model of its own and needs a session row
   * of its own, keyed by its id. The row is a snapshot taken *after* the switch has sealed, which is why the
   * shell writes it here and not from inside `run()`; the module only states what happened (`modelVariant`
   * present, `modelId` moved).
   *
   * The guard is the whole idempotency: it claims a fork once, so a re-render, a later store change (the run
   * downstream re-running against the variant), or StrictMode's double-invoke never write a second time, and a
   * session that *arrived* with a variant recorded — a load, a reset — is adopted as already rowed and writes
   * nothing. The claim is taken before the write, so a failure is reported and not retried; a later save of the
   * same model upserts the same row.
   *
   * The write itself is synchronous up to its first await (`persistVariantSession` snapshots the store before it
   * calls the gateway), so the row captures the session as the switch left it — not the runs that follow it in
   * this same commit's other effects.
   */
  useEffect(() => {
    if (mode.kind !== "workflow") return;
    const plan = variantGuard.current.claim(session.store);
    if (plan === undefined) return;
    void persistVariantSession({
      gateway,
      store: session.store,
      workflow: workflow.ref,
      variantModelId: plan.variantModelId,
    }).catch((thrown: unknown) => {
      // The model and its copy exist; only the copy's session row is missing. Report it — the switch is already
      // in the live store, and this model's next save writes the same row by the same key. Not retried here: the
      // fork is claimed once.
      setError(
        t(
          "modelBuilder.shell.variantSessionFailed",
          "The variant was created, but its session could not be saved: {{reason}}",
          { reason: thrown instanceof Error ? thrown.message : String(thrown) },
        ),
      );
    });
  }, [gateway, mode.kind, session.store, storeVersion, workflow, t]);

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
      hold={held}
    />
  );

  // Nothing on screen while the load is in flight: the flow's seed would render first, and an empty builder
  // that is about to fill in reads as data loss. Placed after every hook, since it is an early return.
  if (loading) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">
          {t("modelBuilder.shell.loadingModel", "Loading the model…")}
        </p>
      </div>
    );
  }

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

            {/* Bounded box: intrinsic height, capped at ¼ of the content area — a cap, not a quota.
                Stacked ABOVE the overlay slot: a module's own forward action is chrome, not content, and burying
                it under the module's own modal leaves a button that looks live and cannot be pressed. */}
            {inRegion("bottom") && (
              <footer className="relative z-50 max-h-[25%] shrink-0 overflow-hidden border-t border-border bg-card px-6 py-3">
                <View {...viewProps("bottom")} />
              </footer>
            )}
          </div>
        </div>

        {/* Starts the 3D preparation for the grid on screen, once, beside the bars. The package draws a building
            from City2TABULA's geometry, and that geometry only exists once this run has been asked for. */}
        <BuildingPreparation />

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

/**
 * The shell: it loads the default workflow, then renders the frame — and nothing else.
 *
 * This is the wait the flow's move off a static import created. Before Stage 2 the frame built its session
 * during its first render, because the definition was an `import` and already present; a database row is not,
 * so the frame cannot exist until the fetch lands. The two early returns below sit after every hook in this
 * component, since a conditional return above a hook is what breaks React.
 *
 * Both outcomes are reported in the frame's own style (a centred message) rather than thrown into a white
 * screen: the flow is user data (`plan §3`).
 */
export const BuilderShell: React.FC = () => {
  const { t } = useTranslation();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── the flow to open: `?workflow=<id>`, a sibling of the frame's `?model=<id>` ─────────────────────
  //
  // The request names which stored workflow to run; absent, the default is loaded. It is a load parameter,
  // not a control inside the session, because the flow is immutable once a session starts (`core/flow.ts`):
  // a different pathway is a different load. The picker that will point at this is a later step; this is its
  // seam, read the same way `?model=` is in the frame below.
  const [search] = useSearchParams();
  const requestedWorkflow = search.get("workflow");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadDefaultWorkflow(requestedWorkflow ?? undefined);
        if (cancelled) return;
        if (loaded === undefined) {
          // A missing default is a data condition with a named fix, not a transport fault — the same
          // distinction the `?model=` load draws between "no session" and a thrown error. A requested id
          // that names no stored workflow takes the same path, naming the id it could not find.
          setError(
            requestedWorkflow === null
              ? t("modelBuilder.shell.noDefaultWorkflow", "No default workflow is set — run `make seed`.")
              : t(
                  "modelBuilder.shell.noRequestedWorkflow",
                  "No stored workflow matches \"{{id}}\".",
                  { id: requestedWorkflow },
                ),
          );
          return;
        }
        setWorkflow(loaded);
      } catch (thrown) {
        if (cancelled) return;
        // A rejected fetch, or a document `toWorkflow` refused — most often a node naming a module the
        // catalogue no longer declares. Both name their own cause; report it rather than take the surface down.
        setError(
          t("modelBuilder.shell.workflowLoadFailed", "The workflow could not be loaded: {{reason}}", {
            reason: thrown instanceof Error ? thrown.message : String(thrown),
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, requestedWorkflow]);

  // Nothing renders until a flow exists: the frame derives its whole position from one, and an empty builder
  // that is about to fill in reads as data loss — the same reason the frame's own load shows a placeholder.
  if (error !== null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (workflow === null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">
          {t("modelBuilder.shell.loadingWorkflow", "Loading the workflow…")}
        </p>
      </div>
    );
  }

  return <BuilderFrame workflow={workflow} />;
};

export default BuilderShell;
