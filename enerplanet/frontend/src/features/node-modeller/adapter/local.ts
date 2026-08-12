/**
 * Local adapter — isolation mode (Plan P7, README_V2 §7.3).
 *
 * No auth, no workspace, no network. Models persist to localStorage as an
 * index + serialized contexts; "download" exports `.enerplanet.json` files.
 * Compute calls (grid, demand, results) are unavailable — the caller gets a
 * NotSupportedError and the UI should fall back to manual/defaults.
 */
import { contextFilename, deserializeContext, serializeContext } from "../context/serialize";
import type { ModelContext, UserTimeseriesRef } from "../context/types";
import { builtinWorkflows } from "../engine/workflows/default-planning";
import type { WorkflowDefinition } from "../engine/types";
import type { BackendAdapter, ModelSummary } from "./types";
import { NotSupportedError } from "./types";

const INDEX_KEY = "node-modeller:local-models";
const CTX_PREFIX = "node-modeller:local-ctx:";

interface LocalIndexEntry {
  id: number;
  title: string;
  status: string;
  updatedAt: string;
  parentId?: number;
}

function storage(): Storage {
  if (typeof localStorage === "undefined") throw new NotSupportedError("localStorage (non-browser env)");
  return localStorage;
}

function readIndex(): LocalIndexEntry[] {
  try {
    return JSON.parse(storage().getItem(INDEX_KEY) ?? "[]") as LocalIndexEntry[];
  } catch {
    return [];
  }
}

function writeIndex(entries: LocalIndexEntry[]): void {
  storage().setItem(INDEX_KEY, JSON.stringify(entries));
}

function nextId(entries: LocalIndexEntry[]): number {
  return entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
}

/** Trigger a browser download of the serialized context. */
export function downloadContext(ctx: ModelContext): void {
  const blob = new Blob([serializeContext(ctx)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = contextFilename(ctx);
  a.click();
  URL.revokeObjectURL(url);
}

/** Parse an uploaded `.enerplanet.json` file. */
export async function uploadContext(file: File): Promise<ModelContext> {
  return deserializeContext(await file.text());
}

export function createLocalAdapter(): BackendAdapter {
  return {
    async listModels(): Promise<ModelSummary[]> {
      return readIndex();
    },

    async getModelContext(id: number): Promise<ModelContext> {
      const raw = storage().getItem(`${CTX_PREFIX}${id}`);
      if (!raw) throw new Error(`Local model ${id} not found`);
      return deserializeContext(raw);
    },

    async saveModel(ctx: ModelContext): Promise<number> {
      const index = readIndex();
      const id = nextId(index);
      const stored: ModelContext = { ...ctx, id };
      storage().setItem(`${CTX_PREFIX}${id}`, serializeContext(stored));
      index.push({
        id,
        title: ctx.meta.title,
        status: ctx.status,
        updatedAt: new Date().toISOString(),
        parentId: ctx.parentId,
      });
      writeIndex(index);
      return id;
    },

    async updateModel(ctx: ModelContext): Promise<void> {
      if (ctx.id === undefined) throw new Error("Cannot update a model without id");
      storage().setItem(`${CTX_PREFIX}${ctx.id}`, serializeContext(ctx));
      const index = readIndex().map((e) =>
        e.id === ctx.id
          ? { ...e, title: ctx.meta.title, status: ctx.status, updatedAt: new Date().toISOString() }
          : e,
      );
      writeIndex(index);
    },

    // compute endpoints don't exist offline
    generateGrid: () => Promise.reject(new NotSupportedError("generateGrid (offline)")),
    getBoundary: () => Promise.reject(new NotSupportedError("getBoundary (offline)")),
    gridStatistics: () => Promise.reject(new NotSupportedError("gridStatistics (offline)")),
    estimateDemandBatch: () => Promise.reject(new NotSupportedError("estimateDemandBatch (offline)")),
    listTechnologies: () => Promise.reject(new NotSupportedError("listTechnologies (offline)")),
    startCalculation: () => Promise.reject(new NotSupportedError("startCalculation (offline)")),
    getResults: () => Promise.reject(new NotSupportedError("getResults (offline)")),

    listTimeseries: () => Promise.reject(new NotSupportedError("timeseries API")),
    deleteTimeseries: () => Promise.reject(new NotSupportedError("timeseries API")),

    // workflows are built-in locally
    async listWorkflows(): Promise<WorkflowDefinition[]> {
      return builtinWorkflows;
    },
    saveWorkflow: () => Promise.reject(new NotSupportedError("saveWorkflow (offline)")),
  };
}

/** Test hook: wipe all local adapter state. */
export function clearLocalAdapterState(): void {
  if (typeof localStorage === "undefined") return;
  const ids = readIndex().map((e) => e.id);
  ids.forEach((id) => localStorage.removeItem(`${CTX_PREFIX}${id}`));
  localStorage.removeItem(INDEX_KEY);
}

export type { UserTimeseriesRef };
