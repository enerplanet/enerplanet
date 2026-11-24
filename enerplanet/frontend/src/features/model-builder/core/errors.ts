/**
 * Typed failures of the write boundary.
 *
 * The engine validates every commit *before* a transaction exists, so a rejection always means
 * "nothing happened".
 */

import type { PortKey } from "./ports";

/** Why a write was refused. */
export type PortWriteRejection =
  /** The module did not declare the port in its `params`. */
  | "undeclared"
  /** The module would blind-overwrite a value it never read (anti-clobber). */
  | "clobber"
  /** The value carries nothing: an empty string, `null`, or `undefined` (a zero-member collection is a value). */
  | "empty";
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

/** A node was asked to run at a position whose required inputs do not exist in the store. */
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

/**
 * A listener tried to write to the store from inside a notification — notification is not re-entry.
 */
export class ReentrantStoreWrite extends Error {
  constructor() {
    super("[model-builder] the store changed from inside a notification: a listener must never write");
    this.name = "ReentrantStoreWrite";
  }
}
