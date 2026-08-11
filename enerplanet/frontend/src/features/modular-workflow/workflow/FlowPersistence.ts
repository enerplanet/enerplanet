import type { ConfiguratorContext } from "../types/context";
import type { NodeStatus } from "../types/workflow";

/**
 * A serializable snapshot of a flow's state, persisted to `localStorage` so a
 * flow is not discarded when the user leaves, loses connection, or exits while
 * waiting on a long model run. Mirrors the `flowSnapshot` field on
 * `ConfiguratorContext` (Phase 2).
 */
export interface FlowSnapshot {
  workflowId: string;
  workflowVersion?: number;
  context: Partial<ConfiguratorContext>;
  nodeStates: Record<string, NodeStatus>;
  savedAt: string;
}

/** Stable localStorage key under which the flow snapshot is stored. */
export const FLOW_SNAPSHOT_KEY = "modular-workflow:flow";

/** Marker used by the JSON replacer/reviver to round-trip Maps. */
const MAP_MARKER = "__flowMap__";
/** Marker used by the JSON replacer/reviver to round-trip Sets. */
const SET_MARKER = "__flowSet__";

/**
 * JSON replacer that converts `Map` and `Set` instances into tagged plain
 * objects so they survive `JSON.stringify` (e.g. `buildingEstimates` is a
 * `Map`, `buildingFilters.excludedIds` is a `Set`).
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) {
    return { [MAP_MARKER]: true, entries: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { [SET_MARKER]: true, values: Array.from(value.values()) };
  }
  return value;
}

/**
 * JSON reviver that restores the tagged Map/Set objects produced by `replacer`
 * back into real `Map` / `Set` instances on load.
 */
function reviver(_key: string, value: unknown): unknown {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record[MAP_MARKER] === true && Array.isArray(record.entries)) {
      return new Map(record.entries as [unknown, unknown][]);
    }
    if (record[SET_MARKER] === true && Array.isArray(record.values)) {
      return new Set(record.values as unknown[]);
    }
  }
  return value;
}

/**
 * Serialize a flow snapshot to `localStorage` under a stable key.
 *
 * Guards all storage access in try/catch so SSR and privacy-mode (where
 * `localStorage` may be unavailable or throw) never break the flow.
 */
export function saveFlowSnapshot(snapshot: FlowSnapshot): void {
  try {
    const serialized = JSON.stringify(snapshot, replacer);
    window.localStorage.setItem(FLOW_SNAPSHOT_KEY, serialized);
  } catch (err) {
    console.warn(
      "[FlowPersistence] Failed to save flow snapshot:",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Read and parse the persisted flow snapshot from `localStorage`, restoring
 * any Maps/Sets. Returns `null` when nothing is stored or the data is invalid.
 */
export function loadFlowSnapshot(): FlowSnapshot | null {
  try {
    const raw = window.localStorage.getItem(FLOW_SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw, reviver) as FlowSnapshot;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.workflowId !== "string" ||
      typeof parsed.context !== "object" ||
      parsed.context === null ||
      typeof parsed.nodeStates !== "object" ||
      parsed.nodeStates === null
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(
      "[FlowPersistence] Failed to load flow snapshot:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Remove the persisted flow snapshot (called on successful save/complete). */
export function clearFlowSnapshot(): void {
  try {
    window.localStorage.removeItem(FLOW_SNAPSHOT_KEY);
  } catch (err) {
    console.warn(
      "[FlowPersistence] Failed to clear flow snapshot:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Whether a flow snapshot is currently persisted. */
export function hasFlowSnapshot(): boolean {
  try {
    return window.localStorage.getItem(FLOW_SNAPSHOT_KEY) !== null;
  } catch {
    return false;
  }
}
