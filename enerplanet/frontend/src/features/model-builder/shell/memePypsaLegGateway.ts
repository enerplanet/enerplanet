/**
 * The PyPSA-leg gateway the frame installs — the backend's own model endpoints, through the app's HTTP client.
 *
 * The module declares the slot (`modules/run-meme-pypsa/source.ts`) and never learns which gateway it has.
 * Submit posts `POST /models/:id/run-meme-pypsa`; status reads the leg's own status (`pypsa_leg_status`).
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

/** The leg's status string onto the port's vocabulary — read directly, not derived. */
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
    // The endpoint marks the leg pending synchronously and returns 200 only once it has.
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
