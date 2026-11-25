/**
 * The PyPSA-leg gateway slot — what `run-meme-pypsa` needs from a host, and nothing more.
 *
 * The module dispatches a power-flow leg and reads its status through an injected gateway; both calls go over
 * the app's HTTP client, which a module may not import. There is no default. `MemePypsaLeg` is the core port,
 * reused here rather than restated.
 */

import type { MemePypsaLeg } from "@model-builder/core";

/** What a host must provide for this module to work: dispatch the power-flow leg, and read its status. */
export interface MemePypsaLegGateway {
  /** Dispatch the power-flow leg and answer its initial record; a refused leg (no completed Calliope run, or one already in flight) throws. */
  submit(modelId: number): Promise<MemePypsaLeg>;
  /** Read the model's power-flow leg. The leg's status is exposed directly (`pypsa_leg_status`). */
  status(modelId: number): Promise<MemePypsaLeg>;
}

let gateway: MemePypsaLegGateway | null = null;

/** Install the gateway. The frame calls this at startup, the way it installs the Calliope run's. */
export function setMemePypsaLegGateway(next: MemePypsaLegGateway | null): void {
  gateway = next;
}

/** The installed gateway, or null when no host has provided one. There is no default (see the file comment). */
export function memePypsaLegGateway(): MemePypsaLegGateway | null {
  return gateway;
}
