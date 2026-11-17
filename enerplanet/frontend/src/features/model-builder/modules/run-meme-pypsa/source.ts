/**
 * The PyPSA-leg gateway slot — what `run-meme-pypsa` needs from a host, and nothing more.
 *
 * The module declares that it *can* dispatch a power-flow leg and read one's status, and never learns how: both
 * calls go over the app's HTTP client to the backend's own endpoints, and a module may not import that client.
 * A host installs the implementation at startup — the same slot shape `run-meme-calliope` uses for its run:
 * an interface, a module-scope value, an installer and a getter.
 *
 * **There is no default.** Like the Calliope run's slot, this module's I/O genuinely leaves the process, so
 * there is nothing local to fall back to and a fabricated leg would be a lie about the backend. A missing
 * gateway is therefore an error the run reports, and the message names the installer.
 *
 * `MemePypsaLeg` is the core port (`@model-builder/core`), reused here rather than restated: what the gateway
 * answers *is* the value the port holds, so one shape serves both and neither can drift from the other.
 */

import type { MemePypsaLeg } from "@model-builder/core";

/** What a host must provide for this module to work: dispatch the power-flow leg, and read its status. */
export interface MemePypsaLegGateway {
  /**
   * Dispatch the model's isolated PyPSA power-flow leg and answer the leg's initial record.
   *
   * The backend refuses the leg unless the Calliope run has completed, and refuses a second dispatch while one
   * is pending or running — both throw. The leg never touches the model's own status.
   */
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
