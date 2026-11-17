/**
 * The PyPSA-leg gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/run-meme-pypsa/source.ts`) and never learns which gateway it has; this
 * is the implementation a host provides, beside the Calliope run's (`shell/memeRunGateway.ts`) and for the same
 * reason — a module may only depend on `@model-builder/core`, while the app's CSRF-aware axios instance is the
 * app's. The module is told about this one at startup (`setMemePypsaLegGateway`, via `installMemePypsaLegGateway`).
 *
 * **Submit.** `POST /models/:id/run-meme-pypsa` — the isolated power-flow leg, no `frameworks` field (the leg is
 * fixed). The backend marks the leg `pending` synchronously *before* enqueuing and returns 200 only once it has,
 * so `pending` is the leg's state the moment the call returns. The response body is the model **without** the
 * leg field populated — `populatePyPSALegStatus` runs on `GET` only, and the leg deliberately never touches the
 * model's `status` — so the gateway reports `pending` rather than reading an absent field. (The dashboard makes
 * the same call from the other side: it sets the leg optimistically after a dispatch rather than trusting a
 * response, `useModelsQuery`.)
 *
 * **Status.** Read **directly** from the leg — `GET /models/:id` carries the leg's own status as
 * `pypsa_leg_status`, filled by `populatePyPSALegStatus` in `internal/model/handler/model_helpers_query.go`
 * from `model_meme_runs` where `leg = pypsa`. This is the difference from the Calliope run's gateway: that one
 * must *map the model's lifecycle* onto the run vocabulary because the Calliope leg's row is server-side and on
 * no frontend response. **This** leg is the one the backend actually exposes, which is *why* the model dashboard
 * keeps a separate `PYPSA_LEG_RUNNING` set (`features/model-dashboard/hooks/useModelsQuery.ts`) — the isolated
 * leg never moves the model's `status`, so the dashboard cannot read it off the model lifecycle either.
 *
 * **A failed dispatch is invisible here, as it is to the dashboard.** When the backend refuses a dispatch (no
 * completed Calliope run, a leg already in flight), the POST is a non-2xx and axios throws; a dispatch that
 * fails before the leg row exists leaves it absent. This gateway reports the leg's *status*, not the dispatch's
 * own outcome — a limitation shared with the dashboard rather than an oversight.
 *
 * The TentaCron job id (`model_meme_runs.run_id`) and the leg's failure message (`model_meme_runs.error`) are
 * likewise server-side and on no response that carries them, so `runId` and `error` are left unset — the same
 * honest limitation the Calliope run's gateway notes for `runId`.
 */

import axios from "@/lib/axios";
import type { MemePypsaLeg } from "@model-builder/core";
import { setMemePypsaLegGateway, type MemePypsaLegGateway } from "../modules/run-meme-pypsa";

/** The envelope the model endpoints answer with (`httputil.SuccessResponse`). */
interface ModelEnvelope {
  data?: ModelPayload;
}

/** The fields of a model this gateway reads. Only the leg's status is needed — it is exposed directly. */
interface ModelPayload {
  pypsa_leg_status?: string;
}

/**
 * The leg's status string onto the port's vocabulary — read directly, not derived.
 *
 * The backend stores four values (`models.MemeRunStatus*`): `pending` and `running` while the leg is in flight,
 * `completed` and `failed` terminal. They pass through verbatim, so nothing here disagrees with the server.
 *
 * Anything else — including an empty field, which is what a model **without** a leg row carries — is reported as
 * `failed`: the field is authoritative and only ever holds those four, so an unrecognised or absent value means
 * there is no live leg to poll. Like the Calliope gateway's fallback, this is deliberately **not** a `pending`
 * default, which would poll a leg that does not exist forever.
 */
export function memePypsaLegStatusOf(raw: string): MemePypsaLeg["status"] {
  switch (raw) {
    case "pending":
    case "running":
    case "completed":
    case "failed":
      return raw;
    default:
      return "failed";
  }
}

/** A model payload as the leg's record — the whole mapping, pure and exported so it is tested directly. */
export function memePypsaLegOf(payload: ModelPayload | undefined): MemePypsaLeg {
  return { framework: "pypsa", status: memePypsaLegStatusOf(payload?.pypsa_leg_status ?? "") };
}

export const backendMemePypsaLegGateway: MemePypsaLegGateway = {
  async submit(modelId) {
    await axios.post<ModelEnvelope>(`/models/${modelId}/run-meme-pypsa`);
    // The endpoint marks the leg pending synchronously and returns 200 only once it has; the body omits the leg
    // field, so `pending` is the record of what the leg is now.
    return { framework: "pypsa", status: "pending" };
  },

  async status(modelId) {
    const response = await axios.get<ModelEnvelope>(`/models/${modelId}`);
    return memePypsaLegOf(response.data.data);
  },
};

/** Install it. Called once, at startup, beside the Calliope run's gateway. */
export function installMemePypsaLegGateway(): void {
  setMemePypsaLegGateway(backendMemePypsaLegGateway);
}
