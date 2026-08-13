/**
 * NodeModeller shell (Plan P3).
 *
 * Owns the context store + workflow state and renders the current node's UI.
 * Fully self-contained: the host only provides a BackendAdapter (and an
 * optional initial context for edit/branch flows).
 */
import { useCallback, useMemo, useState } from "react";
import type { BackendAdapter } from "../adapter/types";
import type { ModelContext } from "../context/types";
import { validateNode } from "../engine/runner";
import type { WorkflowDefinition } from "../engine/types";
import { defaultPlanningWorkflow } from "../engine/workflows/default-planning";
import { AreaGridNode } from "../nodes/AreaGridNode";
import { ModelSettingsNode } from "../nodes/ModelSettingsNode";
import { PlaceholderNode } from "../nodes/PlaceholderNode";
import { useContextStore } from "./context-store";
import { UndoChip } from "./UndoChip";

export interface NodeModellerProps {
  api: BackendAdapter;
  workflow?: WorkflowDefinition;
  /** Hydrated context for edit / branch / optimization starts. */
  initialContext?: ModelContext;
  /** Node UI overrides — host may replace any node without forking the shell. */
  nodeUis?: Partial<Record<string, React.ComponentType<import("./context-store").NodeUiProps>>>;
}

const DEFAULT_UIS: Record<string, React.ComponentType<import("./context-store").NodeUiProps>> = {
  "module:model-settings": ModelSettingsNode,
  "module:area-grid": AreaGridNode,
};

export function NodeModeller({ api, workflow, initialContext, nodeUis }: NodeModellerProps) {
  const def = workflow ?? defaultPlanningWorkflow;
  const store = useContextStore(initialContext);
  const [stepIndex, setStepIndex] = useState(0);

  const node = def.nodes[stepIndex];
  const uis = useMemo(() => ({ ...DEFAULT_UIS, ...nodeUis }), [nodeUis]);
  const NodeUi = uis[node.type] ?? PlaceholderNode;

  const goNext = useCallback(() => {
    setStepIndex((i) => Math.min(i + 1, def.nodes.length - 1));
  }, [def.nodes.length]);

  return (
    <div className="flex h-full flex-col">
      {/* step nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-b px-4 py-2">
        {def.nodes.map((n, i) => {
          const v = validateNode(def, n.id, store.ctx);
          const active = i === stepIndex;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setStepIndex(i)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors ${
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${v.ok ? "bg-green-500" : "bg-amber-400"}`}
                title={v.ok ? "complete" : v.issues[0]?.message}
              />
              {n.id}
            </button>
          );
        })}
      </nav>

      {/* current node */}
      <main className="min-h-0 flex-1 overflow-auto p-4">
        <NodeUi store={store} api={api} goNext={goNext} />
      </main>

      {/* persistent undo feedback (README_V2 §6.2) */}
      <UndoChip store={store} />
    </div>
  );
}
