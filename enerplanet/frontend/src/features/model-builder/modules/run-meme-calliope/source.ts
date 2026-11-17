/**
 * The MEME-run gateway slot — what `run-meme-calliope` needs from a host, and nothing more.
 *
 * The module declares that it *can* submit a run and read one's status, and never learns how: both calls go
 * over the app's HTTP client to the backend's own endpoints, and a module may not import that client. A host
 * installs the implementation at startup — the same slot shape `building-demand` uses for its demand source:
 * an interface, a module-scope value, an installer and a getter.
 *
 * **There is no default.** Unlike the `auto` template's area-summary slot, this module's I/O genuinely leaves
 * the process, so there is nothing local to fall back to and a fabricated run would be a lie about the backend.
 * A missing gateway is therefore an error the run reports, exactly as `building-demand` throws when no demand
 * source is installed — and the message names the installer.
 *
 * `MemeRun` is the core port (`@model-builder/core`), reused here rather than restated: what the gateway answers
 * *is* the value the port holds, so one shape serves both and neither can drift from the other.
 */

import type { MemeRun } from "@model-builder/core";

/** What a host must provide for this module to work: submit a run for a model, and read a run's status. */
export interface MemeRunGateway {
  /**
   * Dispatch a Calliope run for the model and answer the run's initial record.
   *
   * Named for the run, not for a framework set: the backend maps anything that is not `"pypsa"` to the
   * `meme-calliope` target, so this node never asks for pypsa. A run the backend refuses (an incomplete model,
   * a live run already in flight) throws.
   */
  submit(modelId: number): Promise<MemeRun>;
  /** Read the model's current run. Progress lives on the model, not on a run-specific endpoint. */
  status(modelId: number): Promise<MemeRun>;
}

let gateway: MemeRunGateway | null = null;

/** Install the gateway. The frame calls this at startup, the way it installs the demand source. */
export function setMemeRunGateway(next: MemeRunGateway | null): void {
  gateway = next;
}

/** The installed gateway, or null when no host has provided one. There is no default (see the file comment). */
export function memeRunGateway(): MemeRunGateway | null {
  return gateway;
}
