/**
 * The variant gateway slot — what `model-variant` needs from a host, and nothing more.
 *
 * The module declares that it *can* make a family copy of a saved model and never learns how: the request goes
 * over the app's HTTP client to the backend's own model endpoints, and a module may not import that client —
 * nor the dashboard's `ModelService`, which is where the copy rule actually lives. A host installs the
 * implementation at startup — the same slot shape `run-meme-calliope` uses for its run: an interface, a
 * module-scope value, an installer and a getter.
 *
 * **There is no default.** Like the run gateways, this module's I/O genuinely leaves the process, so there is
 * nothing local to fall back to and a fabricated variant would be a lie about the backend. A missing gateway is
 * therefore an error the run reports, and the message names the installer.
 *
 * `ModelVariant` is the core port (`@model-builder/core`), reused here rather than restated: what the gateway
 * answers *is* the value the port holds, so one shape serves both and neither can drift from the other.
 */

import type { ModelVariant } from "@model-builder/core";

/** What a host must provide for this module to work: make a family copy of a model, and answer what it made. */
export interface ModelVariantGateway {
  /**
   * Create a family copy of the model and answer the record the port holds — the copy's id, the family's own
   * original (`parent_model_id`), and the copy's title. A copy the backend refuses throws.
   */
  createVariant(modelId: number): Promise<ModelVariant>;
}

let gateway: ModelVariantGateway | null = null;

/** Install the gateway. The frame calls this at startup, the way it installs the run gateways. */
export function setModelVariantGateway(next: ModelVariantGateway | null): void {
  gateway = next;
}

/** The installed gateway, or null when no host has provided one. There is no default (see the file comment). */
export function modelVariantGateway(): ModelVariantGateway | null {
  return gateway;
}
