/**
 * The variant gateway slot — what `model-variant` needs from a host, and nothing more.
 *
 * The module makes a family copy of a saved model through an injected gateway; the request goes over the app's
 * HTTP client (and the dashboard's `ModelService`, which is where the copy rule lives), which a module may not
 * import. There is no default. `ModelVariant` is the core port, reused here.
 */

import type { ModelVariant } from "@model-builder/core";

/** What a host must provide for this module to work: make a family copy of a model, and answer what it made. */
export interface ModelVariantGateway {
  /** Create a family copy and answer the record the port holds (copy id, root id, title); a refused copy throws. */
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
