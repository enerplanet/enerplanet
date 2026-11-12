/**
 * Typed failures of the write boundary (`Plan.md` §12).
 *
 * A rejected write must never leave the store half-changed: the engine validates every
 * commit *before* a transaction exists, so these errors always mean "nothing happened".
 */

import type { PortKey } from "./ports";

/** Why a write was refused. */
export type PortWriteRejection =
  /** The module did not declare the port in its `params`. */
  | "undeclared"
  /** The module would blind-overwrite a value it never read (anti-clobber). */
  | "clobber";

export class PortWriteRejected extends Error {
  readonly moduleId: string;
  readonly port: string;
  readonly reason: PortWriteRejection;

  constructor(moduleId: string, port: string, reason: PortWriteRejection) {
    super(`[model-builder] module "${moduleId}" cannot write port "${port}": ${reason}`);
    this.name = "PortWriteRejected";
    this.moduleId = moduleId;
    this.port = port;
    this.reason = reason;
  }
}

/**
 * A node was asked to run at a position whose inputs do not exist (T21).
 *
 * The available-set the palette uses is a *planning* aid and is deliberately optimistic — a
 * port a module only reads may look "available" before anything produced it. The store is the
 * runtime truth, so the engine refuses rather than letting a node run against a position the
 * flow never actually satisfied.
 */
export class MissingRequiredPorts extends Error {
  readonly moduleId: string;
  readonly missing: PortKey[];

  constructor(moduleId: string, missing: readonly PortKey[]) {
    super(
      `[model-builder] module "${moduleId}" cannot run: required port(s) missing from the store: ${missing.join(", ")}`,
    );
    this.name = "MissingRequiredPorts";
    this.moduleId = moduleId;
    this.missing = [...missing];
  }
}
