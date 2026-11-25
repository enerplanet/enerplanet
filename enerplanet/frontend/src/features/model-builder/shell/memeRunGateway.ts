/**
 * The MEME-run gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/run-meme-calliope/source.ts`) and never learns which gateway it
 * has. Submit posts `POST /models/:id/run-meme`; status reads the model's own lifecycle (`GET /models/:id`),
 * mapped onto the backend's run vocabulary. The status sets are the model dashboard's, copied by value.
 */

import axios from "@/lib/axios";
import type { MemeRun } from "@model-builder/core";
import { setMemeRunGateway, type MemeRunGateway } from "../modules/run-meme-calliope";

/** The envelope the model endpoints answer with (`httputil.SuccessResponse`). */
interface ModelEnvelope {
  data?: ModelPayload;
}

/** The failure fields of a model's `results`. */
interface ModelResults {
  error?: unknown;
  failed_stage?: unknown;
  failed_service?: unknown;
}

/** The fields of a model this gateway reads. */
interface ModelPayload {
  status?: string;
  pypsa_leg_status?: string;
  results?: ModelResults | null;
}

/** The model statuses an active run is in — copied from the dashboard's `isActiveStatus`. */
const ACTIVE_MODEL_STATUSES = new Set(["queue", "buildings", "running", "calculating", "processing"]);

/** The model statuses a completed run is in — copied from the dashboard's `isModelCompleted`. */
const COMPLETED_MODEL_STATUSES = new Set(["completed", "published"]);

/** The PyPSA-leg statuses that count as an in-flight run — copied from the dashboard's `PYPSA_LEG_RUNNING`. */
const PYPSA_LEG_RUNNING = new Set(["running", "pending"]);

/** The active statuses before the solve, which the port reports as `pending` rather than `running`. */
const PRE_SOLVE_MODEL_STATUSES = new Set(["queue", "buildings"]);

/** The model's lifecycle onto the run's status (`MemeRun["status"]`). */
export function memeRunStatusOf(modelStatus: string, pypsaLegStatus = ""): MemeRun["status"] {
  if (ACTIVE_MODEL_STATUSES.has(modelStatus) || PYPSA_LEG_RUNNING.has(pypsaLegStatus)) {
    return PRE_SOLVE_MODEL_STATUSES.has(modelStatus) ? "pending" : "running";
  }
  if (COMPLETED_MODEL_STATUSES.has(modelStatus)) return "completed";
  return "failed";
}

/** A non-empty string, or undefined — the payload's fields are `unknown`, so each is checked before use. */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** A failed run's message, from the fields the dashboard's failed badge reads. */
function failureMessage(modelStatus: string, results: ModelResults | null | undefined): string | undefined {
  const service = nonEmpty(results?.failed_service);
  const stage = nonEmpty(results?.failed_stage);
  if (service !== undefined) {
    return stage !== undefined ? `${service} failed at the "${stage}" stage` : `${service} failed`;
  }
  if (stage !== undefined) return `failed at the "${stage}" stage`;

  const error = nonEmpty(results?.error);
  if (error !== undefined) return error;

  // Nothing recorded a failure — the run never started, or the model is in an unanticipated status.
  const named = modelStatus.length > 0 ? `"${modelStatus}"` : "unknown";
  return `the run produced no result (model status: ${named})`;
}

/** A model payload as the run's record — the whole mapping, pure and exported so it is tested directly. */
export function memeRunOf(payload: ModelPayload | undefined): MemeRun {
  const status = memeRunStatusOf(payload?.status ?? "", payload?.pypsa_leg_status ?? "");
  const error = status === "failed" ? failureMessage(payload?.status ?? "", payload?.results) : undefined;
  return {
    framework: "calliope",
    status,
    ...(error !== undefined ? { error } : {}),
  };
}

export const backendMemeRunGateway: MemeRunGateway = {
  async submit(modelId) {
    const response = await axios.post<ModelEnvelope>(`/models/${modelId}/run-meme`);
    return memeRunOf(response.data.data);
  },

  async status(modelId) {
    const response = await axios.get<ModelEnvelope>(`/models/${modelId}`);
    return memeRunOf(response.data.data);
  },
};

/** Install it. Called once, at startup, beside the grid engine and the demand source. */
export function installMemeRunGateway(): void {
  setMemeRunGateway(backendMemeRunGateway);
}
