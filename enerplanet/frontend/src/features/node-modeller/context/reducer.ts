/**
 * Context reducer — the ONLY way to change a ModelContext (Plan P1).
 *
 * `apply(ctx, action)` returns `{ next, diff }`. Every mutating action:
 *   - deep-clones affected slices (immutability rule)
 *   - produces a reversible diff (JSON-pointer-ish paths)
 *   - appends a HistoryEntry, pushes the diff on undoStack, clears redoStack
 *
 * undo/redo invert stored diffs — O(1) per step, no recompute.
 */
import type {
  ApplyResult,
  ContextAction,
  ContextDiff,
  HistoryEntry,
  ModelContext,
} from "./types";

/** Max retained undo steps — bounds memory on long sessions. */
const UNDO_LIMIT = 200;

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

// ── tiny JSON-pointer helpers (paths like "/meta/title") ────────────────────

function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function getAt(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const seg of pathSegments(path)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function setAt(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = pathSegments(path);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur[segs[i]] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]] = value;
}

function removeAt(obj: Record<string, unknown>, path: string): void {
  const segs = pathSegments(path);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    cur = cur[segs[i]] as Record<string, unknown>;
  }
  delete cur[segs[segs.length - 1]];
}

function invert(diff: ContextDiff[]): ContextDiff[] {
  // Apply in reverse order so multi-op diffs restore correctly.
  return [...diff].reverse().map((d) =>
    d.op === "replace"
      ? { op: "replace", path: d.path, prev: d.next, next: d.prev }
      : { op: "replace", path: d.path, prev: undefined, next: d.prev },
  );
}

function applyDiffs(ctx: ModelContext, diffs: ContextDiff[]): ModelContext {
  const next = clone(ctx);
  for (const d of diffs) {
    if (d.op === "replace") {
      if (d.next === undefined) removeAt(next as unknown as Record<string, unknown>, d.path);
      else setAt(next as unknown as Record<string, unknown>, d.path, d.next);
    } else {
      removeAt(next as unknown as Record<string, unknown>, d.path);
    }
  }
  return next;
}

// ── diff builder for partial-slice updates ──────────────────────────────────

/**
 * Builds replace-diffs for a shallow merge of `patch` into the object at
 * `basePath`. Records prev values from `source` for reversibility.
 */
function mergeDiffs(
  source: Record<string, unknown>,
  basePath: string,
  patch: Record<string, unknown>,
): { merged: Record<string, unknown>; diffs: ContextDiff[] } {
  const merged = { ...source };
  const diffs: ContextDiff[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    diffs.push({
      op: "replace",
      path: `${basePath}/${key}`,
      prev: clone(source[key]),
      next: clone(value),
    });
    merged[key] = clone(value);
  }
  return { merged, diffs };
}

// ── history bookkeeping ─────────────────────────────────────────────────────

function commit(
  ctx: ModelContext,
  actionType: string,
  diffs: ContextDiff[],
  slicePatches: Partial<ModelContext>,
  nodeId?: string,
): ApplyResult {
  if (diffs.length === 0) return { next: ctx, diff: [] };
  const revision = ctx.revision + 1;
  const entry: HistoryEntry = {
    revision,
    timestamp: new Date().toISOString(),
    nodeId,
    actionType,
    diff: diffs,
  };
  const next: ModelContext = {
    ...ctx,
    ...slicePatches,
    revision,
    status: ctx.status === "draft" ? "modified" : ctx.status,
    history: [...ctx.history, entry],
    undoStack: [...ctx.undoStack, diffs].slice(-UNDO_LIMIT),
    redoStack: [],
  };
  return { next, diff: diffs };
}

// ── the reducer ─────────────────────────────────────────────────────────────

export function apply(ctx: ModelContext, action: ContextAction): ApplyResult {
  switch (action.type) {
    case "set-meta": {
      const { merged, diffs } = mergeDiffs(
        ctx.meta as unknown as Record<string, unknown>,
        "/meta",
        action.payload as Record<string, unknown>,
      );
      return commit(ctx, action.type, diffs, { meta: merged as unknown as ModelContext["meta"] });
    }

    case "set-region": {
      const { merged, diffs } = mergeDiffs(
        ctx.region as unknown as Record<string, unknown>,
        "/region",
        action.payload as Record<string, unknown>,
      );
      return commit(ctx, action.type, diffs, { region: merged as ModelContext["region"] });
    }

    case "set-grid": {
      const { merged, diffs } = mergeDiffs(
        ctx.grid as unknown as Record<string, unknown>,
        "/grid",
        action.payload as Record<string, unknown>,
      );
      return commit(ctx, action.type, diffs, { grid: merged as unknown as ModelContext["grid"] });
    }

    case "update-building": {
      const { osmId, patch } = action.payload;
      const idx = ctx.grid.buildings.findIndex((b) => b.osmId === osmId);
      if (idx === -1) return { next: ctx, diff: [] };
      const building = ctx.grid.buildings[idx];
      const { merged, diffs } = mergeDiffs(
        building as unknown as Record<string, unknown>,
        `/grid/buildings/${idx}`,
        patch as Record<string, unknown>,
      );
      const buildings = [...ctx.grid.buildings];
      buildings[idx] = merged as unknown as ModelContext["grid"]["buildings"][number];
      return commit(ctx, action.type, diffs, { grid: { ...ctx.grid, buildings } });
    }

    case "assign-tech": {
      const { osmIds, techId, params, nodeId } = action.payload;
      const assignments = clone(ctx.techAssignments.assignments);
      const diffs: ContextDiff[] = [];
      for (const osmId of osmIds) {
        const list = assignments[osmId] ?? [];
        if (list.some((a) => a.techId === techId)) continue;
        const nextList = [...list, { techId, ...(params ? { params: clone(params) } : {}) }];
        diffs.push({
          op: "replace",
          path: `/techAssignments/assignments/${osmId}`,
          prev: clone(assignments[osmId]),
          next: nextList,
        });
        assignments[osmId] = nextList;
      }
      return commit(ctx, action.type, diffs, { techAssignments: { assignments } }, nodeId);
    }

    case "remove-tech": {
      const { osmIds, techId } = action.payload;
      const assignments = clone(ctx.techAssignments.assignments);
      const diffs: ContextDiff[] = [];
      for (const osmId of osmIds) {
        const list = assignments[osmId];
        if (!list?.some((a) => a.techId === techId)) continue;
        const nextList = list.filter((a) => a.techId !== techId);
        diffs.push({
          op: "replace",
          path: `/techAssignments/assignments/${osmId}`,
          prev: clone(list),
          next: nextList,
        });
        assignments[osmId] = nextList;
      }
      return commit(ctx, action.type, diffs, { techAssignments: { assignments } });
    }

    case "set-demand": {
      const entry = action.payload;
      const entries = clone(ctx.demand.entries);
      const diff: ContextDiff = {
        op: "replace",
        path: `/demand/entries/${entry.buildingId}`,
        prev: clone(entries[entry.buildingId]),
        next: clone(entry),
      };
      entries[entry.buildingId] = clone(entry);
      return commit(ctx, action.type, [diff], { demand: { entries } });
    }

    case "set-pypsa": {
      const { merged, diffs } = mergeDiffs(
        ctx.pypsa as Record<string, unknown>,
        "/pypsa",
        action.payload as Record<string, unknown>,
      );
      return commit(ctx, action.type, diffs, { pypsa: merged });
    }

    case "set-results": {
      const diff: ContextDiff = {
        op: "replace",
        path: "/results",
        prev: clone(ctx.results),
        next: clone(action.payload),
      };
      return commit(ctx, action.type, [diff], { results: clone(action.payload) });
    }

    case "set-status": {
      const diff: ContextDiff = {
        op: "replace",
        path: "/status",
        prev: ctx.status,
        next: action.payload,
      };
      // status changes do not flip draft→modified
      const revision = ctx.revision + 1;
      const next: ModelContext = {
        ...ctx,
        status: action.payload,
        revision,
        history: [
          ...ctx.history,
          { revision, timestamp: new Date().toISOString(), actionType: action.type, diff: [diff] },
        ],
        undoStack: [...ctx.undoStack, [diff]].slice(-UNDO_LIMIT),
        redoStack: [],
      };
      return { next, diff: [diff] };
    }

    case "set-id": {
      const diffs: ContextDiff[] = [];
      const patch: Partial<ModelContext> = {};
      if ("id" in action.payload) {
        diffs.push({ op: "replace", path: "/id", prev: ctx.id, next: action.payload.id });
        patch.id = action.payload.id;
      }
      if ("parentId" in action.payload) {
        diffs.push({
          op: "replace",
          path: "/parentId",
          prev: ctx.parentId,
          next: action.payload.parentId,
        });
        patch.parentId = action.payload.parentId;
      }
      return commit(ctx, action.type, diffs, patch);
    }

    case "add-timeseries": {
      const ts = clone(ctx.userData.timeseries);
      if (ts.some((t) => t.id === action.payload.id)) return { next: ctx, diff: [] };
      const diff: ContextDiff = {
        op: "replace",
        path: "/userData/timeseries",
        prev: clone(ts),
        next: [...ts, clone(action.payload)],
      };
      return commit(ctx, action.type, [diff], {
        userData: { ...ctx.userData, timeseries: diff.next as ModelContext["userData"]["timeseries"] },
      });
    }

    case "remove-timeseries": {
      const ts = ctx.userData.timeseries;
      if (!ts.some((t) => t.id === action.payload.id)) return { next: ctx, diff: [] };
      const nextList = ts.filter((t) => t.id !== action.payload.id);
      const diff: ContextDiff = {
        op: "replace",
        path: "/userData/timeseries",
        prev: clone(ts),
        next: clone(nextList),
      };
      return commit(ctx, action.type, [diff], {
        userData: { ...ctx.userData, timeseries: nextList },
      });
    }

    case "undo": {
      const diffs = ctx.undoStack[ctx.undoStack.length - 1];
      if (!diffs) return { next: ctx, diff: [] };
      const reverted = applyDiffs(
        { ...ctx, undoStack: ctx.undoStack.slice(0, -1), redoStack: [...ctx.redoStack, diffs] },
        invert(diffs),
      );
      return { next: { ...reverted, revision: ctx.revision + 1 }, diff: [] };
    }

    case "redo": {
      const diffs = ctx.redoStack[ctx.redoStack.length - 1];
      if (!diffs) return { next: ctx, diff: [] };
      const redone = applyDiffs(
        { ...ctx, redoStack: ctx.redoStack.slice(0, -1), undoStack: [...ctx.undoStack, diffs] },
        diffs,
      );
      return { next: { ...redone, revision: ctx.revision + 1 }, diff: [] };
    }

    case "load-snapshot": {
      // Branch/restore: replace wholesale, keep the snapshot's own history.
      return { next: clone(action.payload), diff: [] };
    }
  }
}

/** Read helper used by modules and tests. */
export function getAtPath(ctx: ModelContext, path: string): unknown {
  return getAt(ctx, path);
}
