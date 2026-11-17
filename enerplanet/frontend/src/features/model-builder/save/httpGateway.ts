/**
 * The real adapter: the gateway bound to the backend over the shared axios client.
 *
 * The endpoints it uses are exactly the ones that already exist for a save, plus the isolated session
 * API:
 *
 * | call | endpoint |
 * |---|---|
 * | `createModel` | `POST /models` (+ the legacy create's side-effects, below) |
 * | `updateModel` | `PUT /models/:id` |
 * | `saveSession` / `loadSession` | `PUT` / `GET /models/:id/session` |
 *
 * It imports `@/lib/axios` — the app-wide, CSRF-aware client — rather than another feature's service
 * module. The feature owns its own I/O; reaching into `model-dashboard`'s service would tie this
 * feature's save path to a decision in that one.
 *
 * The client is injectable so the request shapes can be pinned in tests, which is the whole reason
 * this file has tests of its own: an endpoint path or a payload key is the kind of thing that breaks
 * silently.
 */

import axios from "@/lib/axios";
import { ARTEFACT_VERSION, type Artefact, type WorkflowRef } from "../core/artefact";
import type { Transaction } from "../core/diff";
import type { CreateContext, LegacyModelPayload, ModelGateway } from "./gateway";

/** The slice of the axios client this adapter uses. */
export interface HttpClient {
  post<T>(url: string, body?: unknown): Promise<{ data: T }>;
  put<T>(url: string, body?: unknown): Promise<{ data: T }>;
  get<T>(url: string): Promise<{ data: T }>;
}

/** The session row as the API returns it (see `backend/internal/model/session/handler.go`). */
interface SessionBody {
  model_id: number;
  workflow_id: string;
  workflow_version: number;
  initial: Record<string, unknown>;
  projection: Record<string, unknown>;
  log: Transaction[];
  discarded: Transaction[];
  cursor: number;
  fingerprint: string;
}

export function createHttpGateway(client: HttpClient = axios): ModelGateway {
  return {
    async createModel(payload: LegacyModelPayload, context?: CreateContext): Promise<{ modelId: number }> {
      const response = await client.post<{ data: { id: number } }>("/models", payload);
      const modelId = response.data?.data?.id;
      if (typeof modelId !== "number") {
        throw new Error("Model created but no ID returned");
      }

      // The legacy create's side-effects, kept here so the save logic never grows a legacy special
      // case. Both are non-fatal in the legacy path — a transformer that could not be finalised must
      // not lose a model that is already saved.
      if (context?.draftId !== undefined && context.userId !== undefined) {
        try {
          await client.post("/v1/pylovo/finalize-transformers", {
            draft_id: context.draftId,
            model_id: modelId,
            user_id: context.userId,
          });
        } catch (error) {
          console.warn("finalizing draft transformers failed", error);
        }

        try {
          await client.post(`/models/${modelId}/series/claim-draft`, { draft_id: context.draftId });
        } catch (error) {
          console.warn("claiming the draft's series failed", error);
        }
      }

      return { modelId };
    },

    async updateModel(modelId: number, payload: LegacyModelPayload): Promise<void> {
      await client.put(`/models/${modelId}`, payload);
    },

    async saveSession(modelId: number, artefact: Artefact, workflow: WorkflowRef): Promise<void> {
      await client.put(`/models/${modelId}/session`, {
        workflow_id: workflow.id,
        workflow_version: workflow.version,
        initial: artefact.initial,
        projection: artefact.projection,
        log: artefact.log,
        discarded: artefact.discarded,
        cursor: artefact.cursor,
        fingerprint: artefact.fingerprint,
      });
    },

    async loadSession(modelId: number): Promise<Artefact | undefined> {
      let body: SessionBody;
      try {
        const response = await client.get<{ data: SessionBody }>(`/models/${modelId}/session`);
        body = response.data?.data;
      } catch (error) {
        // 404 is an answer, not a failure: the model has no session — a legacy model, or a builder
        // model that was never saved. Anything else is a real error and must surface.
        if (isNotFound(error)) return undefined;
        throw error;
      }

      if (body === undefined || body === null) return undefined;

      return {
        version: ARTEFACT_VERSION,
        workflow: { id: body.workflow_id, version: body.workflow_version },
        modelId: body.model_id,
        initial: body.initial,
        projection: body.projection,
        log: body.log,
        discarded: body.discarded,
        cursor: body.cursor,
        fingerprint: body.fingerprint,
      };
    },
  };
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const response = (error as { response?: { status?: number } }).response;
  return response?.status === 404;
}
