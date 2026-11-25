/**
 * The MEME-run gateway slot — what `run-meme-calliope` needs from a host, and nothing more.
 *
 * The module submits a run and reads its status through an injected gateway; both calls go over the app's HTTP
 * client, which a module may not import. There is no default. `MemeRun` is the core port, reused here.
 */

import type { MemeRun } from "@model-builder/core";

/** What a host must provide for this module to work: submit a run for a model, and read a run's status. */
export interface MemeRunGateway {
  /** Dispatch a Calliope run and answer its initial record; a refused run (incomplete model, one already in flight) throws. */
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
