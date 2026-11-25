/**
 * The Model Builder frame — the host a module mounts into.
 *
 * Runs in one of two modes (`frameMode.ts`): **workflow** (the module on screen is the node the session
 * sits on, seeded from the flow) or **test mode** (one module on its own test data, no workflow and no
 * position). The layout is a row: the module column (workflow bar, the slots, the ledger bar) and, beside
 * it, the steps panel — a sibling, so it keeps its full height while the module area shrinks.
 *
 * Owns the workflow and ledger bars and the slots (`sidebar`, `map`, `bottom`, `overlay`), the session (one
 * store plus an engine over it), the gateway installs and the save, and the map host. The component is split
 * in two: `BuilderShell` fetches the default workflow and `BuilderFrame` runs it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "@spatialhub/i18n";
import type { ModelData } from "@model-builder/core";
import { setGridEngine, drawGrid } from "../modules/grid-generation";
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
import { areaGeometry } from "../modules/area-draw";
import { pylovoGridEngine } from "./gridEngine";
import { backendWeatherSource } from "./weatherSource";
import { backendRegionSource } from "./regionSource";
import { pylovoDemandSource } from "./demandSource";
import { backendCatalogueSource } from "./catalogueSource";
import { createEngine, type Engine } from "../core/engine";
import { createStore, type Store } from "../core/store";
import type { Flow } from "../core/flow";
import { transcript } from "../core/flow";
import { createHttpGateway } from "../save/httpGateway";
import { loadSession } from "../load/loader";
import { saveSession } from "./actions";
import { autoRunFor, createAutoGuard } from "./autoRun";
import { createVariantSessionGuard, persistVariantSession } from "./variantSession";
import { useStoreVersion } from "./useStoreVersion";
import { viewedProjection } from "./viewedProjection";
import { WorkflowBar } from "./WorkflowBar";
import { LedgerBar } from "./LedgerBar";
import { StepsPanel } from "./StepsPanel";
import { MAP_PROVIDER, MODULES, bindModelSaveSession } from "./moduleRegistry";
import { frameView, type FrameMode } from "./frameMode";
import { loadDefaultWorkflow, type Workflow } from "./workflow";
import { appendRecommended, recommendedFor, takeableSections } from "../workflows/recommended";
import type { RecommendedSection } from "../workflows/types";
import { createInvalidator } from "../core/invalidate";
import type { BuilderModule, ModuleViewProps, OverlayControl, Region } from "./contract";

interface Session {
  store: Store;
  engine: Engine;
  /** The placed flow this session carries — the seed's, or a loaded artefact's. */
  flow: Flow;
}

/** The auto node the session is on and where its run stands — what the module that shows it is handed. */
interface AutoStatus {
  id: string;
  state: "running" | "done" | "error";
  message?: string;
}

/** The session's identity: which workspace a model is created in, and who made it. */
export interface SessionIdentity {
  workspaceId?: number;
  userId?: string;
}

/** A session over whatever the current mode says the data is: the flow's seed, or a module's test data. */
function sessionFor(workflow: Workflow, seed: Readonly<ModelData>, identity: SessionIdentity): Session {
  const store = createStore(
    {
      ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
      ...(identity.userId === undefined ? {} : { userId: identity.userId }),
      ...seed,
      ...(seed.draftId === undefined ? { draftId: crypto.randomUUID() } : {}),
    },
    { deriveCascade: createInvalidator(workflow.flow, workflow.registry) },
  );
  return { store, engine: createEngine(store), flow: workflow.flow };
}

/**
 * Resolve once a React commit has been made, its effects have run, and the browser has painted it.
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
  // Built once for the frame's lifetime: the map host is the frame's, not a module's.
  const host = useMemo(() => MAP_PROVIDER.createHost(), []);

  // The frame installs the modules' provider slots; a module declares it has an engine or a source.
  useEffect(() => {
    setGridEngine(pylovoGridEngine);
    setWeatherSource(backendWeatherSource);
    setRegionSource(backendRegionSource);
    setDemandSource(pylovoDemandSource);
    installBuildingConfigurator();
    setCatalogueSource(backendCatalogueSource);
    installMemeRunGateway();
    installMemePypsaLegGateway();
    installResultOverviewGateway();
    installModelVariantGateway();
    installCompareVariantGateway();
  }, []);
  const map = host.service;
  const [mode, setMode] = useState<FrameMode>({ kind: "workflow" });

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

  /** The node a run is holding the view on: set while that run is in flight, cleared once its effects have landed. */
  const [held, setHeld] = useState<string | undefined>(undefined);

  /** The placement the session is looking at — a view, not a commit. Absent, the frontier is marked. */
  const [viewed, setViewed] = useState<string | undefined>(undefined);

  // The load: `?model=<id>`, the way the dashboard hands a model over.
  const [search] = useSearchParams();
  const requestedModel = search.get("model");
  /** The request that has already been claimed — a ref, so a load never re-runs on a re-render. */
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
          registry: workflow.registry,
        });
        if (cancelled) return;

        if (outcome.kind === "none") {
          setError(t("modelBuilder.shell.noSession", "This model has no experimental session to load."));
          return;
        }

        setSession({
          store: outcome.session.store,
          engine: createEngine(outcome.session.store),
          flow: outcome.session.flow,
        });
        setViewed(undefined);
        setError(null);

        // Opening a model draws the model itself, not only its camera. A saved session resumes at its
        // frontier — past area-draw and grid-generation — so the modules that own those layers are not
        // mounted and nothing would put them on the map. Both helpers are the owning modules' own, so
        // the frame and the modules cannot drift.
        const loaded = outcome.session.store.data;
        drawGrid(map, {
          buildings: loaded.buildings,
          transformers: loaded.transformers,
          lines: loaded.lines,
          mvLines: loaded.mvLines,
        });
        const area = areaGeometry(loaded.coordinates);
        if (area !== undefined) map.fitTo(area);

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
  }, [requestedModel, gateway, workflow, map, t]);

  /** A dev aid, not a feature — the same kind the map host exposes (`__mbMap`). */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as { __mbSession?: unknown }).__mbSession = session;
  }, [session]);

  // Bind the save node's session where the session itself lives: it reads the session when it runs.
  useEffect(() => {
    bindModelSaveSession({
      gateway,
      store: session.store,
      workflow: workflow.ref,
      flow: session.flow,
      registry: workflow.registry,
      ...(identity.workspaceId === undefined ? {} : { workspaceId: identity.workspaceId }),
      ...(identity.userId === undefined ? {} : { userId: identity.userId }),
    });
    return () => bindModelSaveSession(null);
  }, [gateway, session, workflow, identity]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The auto node's run state, for the module that shows it (`ModuleViewProps.auto`). */
  const [autoStatus, setAutoStatus] = useState<AutoStatus | null>(null);
  /** The idempotency guard for the auto run (`autoRun.ts`); a ref, not state. */
  const autoGuard = useRef(createAutoGuard());
  /** The fork's own session, owed once (`variantSession.ts`); a ref, not state. */
  const variantGuard = useRef(createVariantSessionGuard());
  const [saveNotice, setSaveNotice] = useState<string | undefined>(undefined);
  const [overlayOpen, setOverlayOpen] = useState(false);
  // The frame reads the store; the store tells it when it changed — a seal, an undo, a redo.
  useStoreVersion(session.store);

  // The effective flow the frame walks: the session's placed flow over the store's log.
  const flow = transcript(session.flow, session.store.log);

  /** The follow-up sections a finished run offers — only those whose steps this build can still run. */
  const recommendations = takeableSections(
    recommendedFor(flow, session.store, workflow.document),
    workflow.lookup,
    workflow.registry,
  );

  /** Take a recommended section: grow the session's placed flow by the section's nodes as fresh placements. */
  const takeSection = useCallback(
    (section: RecommendedSection): void => {
      setSession((current) => ({
        ...current,
        flow: appendRecommended(current.flow, section, workflow.lookup, workflow.registry),
      }));
      setViewed(undefined);
    },
    [workflow],
  );

  // What the mode says to show, and what a session should start from.
  const view = frameView(mode, workflow, MODULES, session.store, flow, held);

  const run = async (): Promise<void> => {
    const entry = view.entry;
    if (entry === undefined) return;
    const at = view.nodeId;
    const moduleId = view.moduleId;
    try {
      if (at !== undefined && moduleId !== undefined) setHeld(at);
      // In a workflow the transaction is stamped with the node id and its module; in test mode nothing is stamped.
      await session.engine.runModule(
        entry.module,
        at === undefined || moduleId === undefined ? undefined : { id: at, moduleId },
      );
      // The view snaps to the tip: a run is a change, so the session stops looking at an older placement.
      setViewed(undefined);
      setError(null);
    } catch (thrown) {
      // A rejected write, a missing required port or a save refusal: nothing was sealed.
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      // Two frames, so the derived position takes over only after the run's effects have drawn.
      await nextPaint();
      setHeld(undefined);
    }
  };

  /**
   * The bar's save: Call A (the legacy payload) then Call B (the session artefact), status pinned to
   * `incomplete`.
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

  /** Move the frame to a mode, re-seeding the session for it. Reset is the same call with the current mode. */
  const switchTo = (target: FrameMode): void => {
    const next = frameView(target, workflow, MODULES, session.store, flow);
    setMode(target);
    setHeld(undefined);
    setViewed(undefined);
    setSession(sessionFor(workflow, next.seed, identity));
    setError(null);
    setSaveNotice(undefined);
    setOverlayOpen(false);
  };

  // The overlay slot's open/closed state lives here, not in a module: the host owns the chrome.
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

  /** The panel renders in both branches of the shell, but not in test mode: there is no position then. */
  const stepsPanel =
    mode.kind === "test" ? null : (
      <StepsPanel
        flow={flow}
        registry={workflow.registry}
        store={session.store}
        // The view is a read-only selection in the shell's session state — a move sets it and writes nothing.
        view={viewed}
        onMove={setViewed}
      />
    );

  /** Run an auto node and reflect it in `autoStatus` — `running`, `done`, or `error`. */
  const launchAuto = useCallback(
    (nodeId: string, module: BuilderModule["module"]): void => {
      setError(null);
      setAutoStatus({ id: nodeId, state: "running" });
      // Hold the frame on this node while it runs, exactly as `run` does, and for the same reason.
      setHeld(nodeId);
      void (async () => {
        try {
          await session.engine.runModule(module, { id: nodeId, moduleId: module.id, auto: true });
          setAutoStatus((current) =>
            current?.id === nodeId ? { id: nodeId, state: "done" } : current,
          );
        } catch (thrown) {
          const message = thrown instanceof Error ? thrown.message : String(thrown);
          setError(message);
          setAutoStatus({ id: nodeId, state: "error", message });
        } finally {
          // Two frames, as in `run`.
          await nextPaint();
          setHeld(undefined);
        }
      })();
    },
    [session.engine],
  );

  /** The auto-run: the session runs the `auto` node it lands on, once, in workflow mode only. */
  const storeVersion = session.store.version;
  useEffect(() => {
    if (mode.kind !== "workflow") return;
    const plan = autoRunFor(flow, workflow.registry, session.store);
    if (plan === undefined) return;
    if (!autoGuard.current.claim(plan)) return;
    launchAuto(plan.id, plan.module);
  }, [launchAuto, mode.kind, session.store, storeVersion, workflow]);

  /**
   * The fork's own session (`variantSession.ts`): committing `modelId` is the switch, so the shell writes
   * the copy's row once.
   */
  useEffect(() => {
    if (mode.kind !== "workflow") return;
    const plan = variantGuard.current.claim(session.store);
    if (plan === undefined) return;
    void persistVariantSession({
      gateway,
      store: session.store,
      workflow: workflow.ref,
      flow: session.flow,
      variantModelId: plan.variantModelId,
    }).catch((thrown: unknown) => {
      // The model and its copy exist; only the copy's session row is missing — reported, not retried.
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
      flow={flow}
      store={session.store}
      mode={mode}
      moduleIds={moduleIds}
      onModeChange={switchTo}
      onReset={() => switchTo(mode)}
      onSave={save}
      saving={saving}
      saveNotice={saveNotice}
      // The bar names the viewed placement — the held node while a run is landing, else the session's view.
      hold={held ?? viewed}
      onMove={setViewed}
    />
  );

  // Nothing on screen while the load is in flight: the flow's seed would render first and read as data loss.
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
  // The module renders from its own commit while the session views a placement; otherwise from the live tip.
  const data = viewedProjection(session.store, viewed);
  const inRegion = (region: Region): boolean => active.module.layout.includes(region);

  // The auto node's run state, handed to its render — and only an auto node's.
  const here = autoStatus !== null && autoStatus.id === view.nodeId ? autoStatus : undefined;
  const auto: ModuleViewProps["auto"] =
    view.auto !== true
      ? undefined
      : {
          state: here?.state ?? "running",
          ...(here?.message === undefined ? {} : { message: here.message }),
          rerun: () => launchAuto(view.nodeId ?? "", active.module),
        };

  // One props object per render: `map` and `overlay` are present only when the module declared that region.
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
          {/* Bounded box: up to ⅓ of the content area. The module owns what happens inside it. */}
          {inRegion("sidebar") && (
            <aside className="w-1/3 min-w-[20rem] shrink-0 overflow-hidden border-r border-border bg-card p-6">
              <View {...viewProps("sidebar")} />
            </aside>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            {/* The map is always here; a module's `map` region layers pass-through controls on top. */}
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

            {/* Bounded box: intrinsic height, capped at ¼ of the content area. */}
            {inRegion("bottom") && (
              <footer className="relative z-50 max-h-[25%] shrink-0 overflow-hidden border-t border-border bg-card px-6 py-3">
                <View {...viewProps("bottom")} />
              </footer>
            )}
          </div>
        </div>

        {/* Starts the 3D preparation for the grid on screen, once, beside the bars. */}
        <BuildingPreparation />

        {/* The follow-up sections a finished run offers; each is a plan addition that appends pending placements. */}
        {recommendations.length > 0 && (
          <div className="relative z-50 shrink-0 border-t border-border bg-card px-6 py-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("modelBuilder.recommended.title", "Suggested next steps")}
            </p>
            <ul className="flex flex-wrap gap-2">
              {recommendations.map((section) => (
                <li
                  key={section.key}
                  className="max-w-xs rounded-lg border border-border bg-background p-3"
                >
                  <button
                    type="button"
                    onClick={() => takeSection(section)}
                    className="rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    {section.label}
                  </button>
                  <p className="mt-1.5 text-xs text-muted-foreground">{section.description}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <LedgerBar store={session.store} />

        {/* Scoped to the module column; an **auto** node forces this slot open. The card outranks the bottom
            region's z-index so a module's own full-screen view stays reachable. */}
        {inRegion("overlay") &&
          (overlayOpen || view.auto === true) &&
          (view.auto === true ? (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm [--sidebar-width:0px] [--topbar-height:0px]">
              <View {...viewProps("overlay")} />
            </div>
          ) : (
            <div className="absolute inset-0 z-[60] flex items-start justify-center bg-background/80 p-6 backdrop-blur-sm [--sidebar-width:0px] [--topbar-height:0px]">
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
 */
export const BuilderShell: React.FC = () => {
  const { t } = useTranslation();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The flow to open: `?workflow=<id>`; absent, the default is loaded.
  const [search] = useSearchParams();
  const requestedWorkflow = search.get("workflow");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadDefaultWorkflow(requestedWorkflow ?? undefined);
        if (cancelled) return;
        if (loaded === undefined) {
          // A missing default is a data condition with a named fix, not a transport fault.
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
        // A rejected fetch, or a document `toWorkflow` refused — both name their own cause.
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

  // Nothing renders until a flow exists: the frame derives its whole position from one.
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
