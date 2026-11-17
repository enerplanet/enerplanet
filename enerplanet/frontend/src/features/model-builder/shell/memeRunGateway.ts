/**
 * The MEME-run gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/run-meme-calliope/source.ts`) and never learns which gateway it has;
 * this is the implementation a host provides, beside the demand source and for the same reason — a module may
 * only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the app's. The module is
 * told about this one at startup (`setMemeRunGateway`, via `installMemeRunGateway`).
 *
 * **Submit.** `POST /models/:id/run-meme` with no `frameworks` field, so the backend maps it to the
 * `meme-calliope` target (anything that is not `"pypsa"` does). The response is the model, now in the `queue`
 * status, which is the run's first record.
 *
 * **Status.** Read from the **model**, not a run-specific endpoint: `GET /models/:id` returns the model's
 * `status`, its `pypsa_leg_status` and its `results`. The Calliope leg's own row lives in `model_meme_runs`
 * server-side and is not on any frontend response, so the run's status is the model's own lifecycle, mapped
 * onto the backend's run vocabulary (`models.MemeRunStatus*`), which the port carries verbatim.
 *
 * **Activeness and failure are the dashboard's rules, not this file's.** Whether the run is active, done or
 * failed is decided exactly as the model dashboard decides it — the sets live in
 * `features/model-dashboard/utils/statusHelpers.ts` (`isActiveStatus`, `isModelCompleted`) and in
 * `features/model-dashboard/hooks/useModelsQuery.ts` (`PYPSA_LEG_RUNNING`, inside `hasActiveRun`). A feature
 * may not import another feature, so those sets are copied here by value rather than imported; keep them in
 * step with the originals deliberately. The poll cadence is the dashboard's too — 5000 ms while a run is
 * active, stopped otherwise — but that interval is the module's (`modules/run-meme-calliope`, `POLL_INTERVAL_MS`)
 * and is left untouched.
 *
 * **A failed dispatch is invisible here, as it is to the dashboard.** When the backend refuses a dispatch, or a
 * dispatch fails before a run record exists, the model's status is left untouched, so no read of the model can
 * report it. This gateway reports the run's *result processing*, not the dispatch's own outcome — a limitation
 * shared with the dashboard rather than an oversight.
 *
 * The TentaCron job id (`model_meme_runs.run_id`) is likewise server-side, so `runId` is left unset.
 */

import axios from "@/lib/axios";
import type { MemeRun } from "@model-builder/core";
import { setMemeRunGateway, type MemeRunGateway } from "../modules/run-meme-calliope";

/** The envelope the model endpoints answer with (`httputil.SuccessResponse`). */
interface ModelEnvelope {
  data?: ModelPayload;
}

/**
 * The failure fields of a model's `results`.
 *
 * `internal/store/model/failed.go` (`FailedResults`) writes exactly these keys when a run fails: `error` (the
 * reason), `failed_stage` (the status the run had when it failed — a model status) and `failed_service` (the
 * service that failed, or null when none). The single-model read is not trimmed, so all three arrive here —
 * unlike the list, which keeps only the keys the dashboard's badge needs (`trimListPayload` in
 * `internal/model/handler/model_helpers_query.go`).
 */
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

/**
 * The model statuses an active run is in — copied verbatim from
 * `features/model-dashboard/utils/statusHelpers.ts`, `isActiveStatus`.
 */
const ACTIVE_MODEL_STATUSES = new Set(["queue", "buildings", "running", "calculating", "processing"]);

/**
 * The model statuses a completed run is in — copied verbatim from
 * `features/model-dashboard/utils/statusHelpers.ts`, `isModelCompleted`.
 */
const COMPLETED_MODEL_STATUSES = new Set(["completed", "published"]);

/**
 * The PyPSA-leg statuses that count as an in-flight run — copied verbatim from
 * `features/model-dashboard/hooks/useModelsQuery.ts`, `PYPSA_LEG_RUNNING`.
 */
const PYPSA_LEG_RUNNING = new Set(["running", "pending"]);

/** The active statuses before the solve, which the port reports as `pending` rather than `running`. */
const PRE_SOLVE_MODEL_STATUSES = new Set(["queue", "buildings"]);

/**
 * The model's lifecycle onto the run's status (`MemeRun["status"]`) — the dashboard's own reading of the model.
 *
 * Active is `ACTIVE_MODEL_STATUSES.has(status) || a running/pending pypsa leg`, exactly as the dashboard's
 * `hasActiveRun` ORs the two: the isolated power-flow leg is an add-on over a completed Calliope run and never
 * touches the model's status, so without the leg check a run would read as finished the moment the leg was
 * dispatched. Within active, the port separates the wait before the solve (`queue`, `buildings` — building
 * demand resolves first) from the solve itself (`running`, `calculating`, `processing`), reported as `pending`
 * and `running` respectively; the module polls on either.
 *
 * Completed is `isModelCompleted` (`completed`, `published`) → `completed`.
 *
 * Every other status is terminal — the dashboard neither polls it nor calls it complete, so the port calls it
 * `failed`: `failed` and `cancelled` are runs that ended without a result, `draft` is a model that never ran,
 * and any status nobody anticipated belongs here rather than defaulting to `pending`, where an unrecognised
 * state would poll forever instead of being reported. This is deliberately not a `pending` default.
 */
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

/**
 * A failed run's message, from the fields the dashboard's failed badge reads
 * (`features/model-dashboard/utils/failureMessage.ts`): `failed_service` names the service, `failed_stage`
 * the stage it failed in. The gateway has no translations, so it names them as the backend recorded them; the
 * raw `results.error` is a fallback only — the dashboard never shows it either — and is what an older payload
 * without a stage or service carries.
 */
function failureMessage(modelStatus: string, results: ModelResults | null | undefined): string | undefined {
  const service = nonEmpty(results?.failed_service);
  const stage = nonEmpty(results?.failed_stage);
  if (service !== undefined) {
    return stage !== undefined ? `${service} failed at the "${stage}" stage` : `${service} failed`;
  }
  if (stage !== undefined) return `failed at the "${stage}" stage`;

  const error = nonEmpty(results?.error);
  if (error !== undefined) return error;

  // Nothing recorded a failure, because nothing failed: the run never started, or the model is in a status
  // nobody anticipated — both of which land on `failed`, the port having no vocabulary for "not started". So
  // the message has to carry the diagnosis itself, which is the model's status. One wording for every case,
  // because a genuine failure with nothing recorded reaches here too.
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
