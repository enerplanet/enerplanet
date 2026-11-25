/**
 * The real adapter: the gateway bound to the backend over the shared axios client.
 *
 * | call | endpoint |
 * |---|---|
 * | `createModel` | `POST /models` (+ the legacy create's side-effects, below) |
 * | `updateModel` | `PUT /models/:id` |
 * | `saveSession` / `loadSession` | `PUT` / `GET /models/:id/session` |
 *
 * It imports `@/lib/axios` — the app-wide, CSRF-aware client — rather than another feature's service
 * module, and the client is injectable so the request shapes can be pinned in tests.
 */

import axios from "@/lib/axios";
import { ARTEFACT_VERSION, type Artefact, type WorkflowRef } from "../core/artefact";
import type { Transaction } from "../core/diff";
import type { FlowNode } from "../core/flow";
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
  flow: FlowNode[];
  log: Transaction[];
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

      // The legacy create's side-effects; both are non-fatal in the legacy path.
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
        flow: artefact.flow,
        log: artefact.log,
        fingerprint: artefact.fingerprint,
      });
    },

    async loadSession(modelId: number): Promise<Artefact | undefined> {
      let body: SessionBody;
      try {
        const response = await client.get<{ data: SessionBody }>(`/models/${modelId}/session`);
        body = response.data?.data;
      } catch (error) {
        // 404 is an answer: the model has no session. Anything else must surface.
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
        flow: body.flow,
        log: body.log,
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
