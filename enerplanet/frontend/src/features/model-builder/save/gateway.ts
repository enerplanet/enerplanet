/**
 * The gateway — the backend seam this feature owns (`Plan.md` §11, "Adapters").
 *
 * The save is a **two-call split** (settled 2026-11, `Plan.md` §11):
 *
 * - **Call A** writes the *legacy* model payload (`model.json` / `config`) through the endpoints that
 *   already exist, unchanged in shape, because parity with the legacy editor is the point;
 * - **Call B** writes the *session artefact* (history + store data) through the isolated session API.
 *
 * A must run first and the order is not a preference: B's row carries a foreign key to the model, and
 * a first save has no model until A returns its id.
 *
 * Everything below is an interface because the core is I/O-free: the real adapter binds the existing
 * `modelService` / `pylovoService` clients, and tests bind a recorder. The legacy *side-effects* of a
 * create — finalising user-placed transformers, claiming the draft's series — belong to the adapter
 * too, behind `createModel`, so the save logic never grows a legacy special case.
 */

import type { Artefact, WorkflowRef } from "../core/artefact";

/** The status a save writes. `incomplete` is the builder's own value; the other two are legacy. */
export type SaveStatus = "draft" | "incomplete" | "modified";

/**
 * The legacy model payload — the wire shape of Call A, kept as close to the legacy
 * `saveAreaData` output as TypeScript allows (the backend owns the schema).
 */
export interface LegacyModelPayload {
  title: string;
  from_date: string;
  to_date: string;
  /** The legacy default is 60 when the flow never set one. */
  resolution: number;
  workspace_id?: number;
  /** The drawn area, wrapped as the legacy did: one ring per polygon. */
  coordinates: GeoJSON.MultiPolygon;
  /** Always an object (see `buildSaveConfig`): an unfinished model sends `{}` rather than nothing. */
  config: Record<string, unknown>;
  status: SaveStatus;
}

/** What a create needs beyond the payload: the legacy draft handles the adapter finalises. */
export interface CreateContext {
  /** Converts user-placed transformers from a draft to the model after the create. */
  draftId?: string;
  userId?: string;
}

export interface ModelGateway {
  /** Call A, create. Returns the new model's id, which Call B then needs. */
  createModel(payload: LegacyModelPayload, context?: CreateContext): Promise<{ modelId: number }>;
  /** Call A, update: the same endpoint for a model that already exists. */
  updateModel(modelId: number, payload: LegacyModelPayload): Promise<void>;

  /** Call B: store the session artefact beside the model. */
  saveSession(modelId: number, artefact: Artefact, workflow: WorkflowRef): Promise<void>;
  /** The read side: the session for a model, or `undefined` when it has none (a legacy model). */
  loadSession(modelId: number): Promise<Artefact | undefined>;
}
