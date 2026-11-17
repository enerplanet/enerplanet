/**
 * Typed failures of the write boundary.
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
  | "clobber"
  /**
   * The value carries nothing: an empty string, `null`, or `undefined`.
   *
   * A zero-member collection is *not* empty here — "no transformers in this area" is a fact a module is
   * entitled to record, and whether that result is finished is the module's own call in `validate()`.
   * Removing a port is the invalidator's job, never a module's.
   */
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

/**
 * A node was asked to run at a position whose inputs do not exist.
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

/**
 * A listener tried to write to the store from inside a notification.
 *
 * **Notification is not re-entry**: a listener re-reads the projection, and may never change it. This is
 * enforced rather than merely documented because a writing listener *recurses* — the store notifies again
 * from inside its own notification, so a single user action can become an unbounded chain.
 *
 * The guard is checked before anything is installed, so a refused write changes nothing, exactly like the
 * rest of the write boundary.
 */
export class ReentrantStoreWrite extends Error {
  constructor() {
    super("[model-builder] the store changed from inside a notification: a listener must never write");
    this.name = "ReentrantStoreWrite";
  }
}

/**
 * A jump was asked for a node that is not behind the current position.
 *
 * Going *forward* is not a jump. The flow walks forward by running nodes, so the session reaches
 * a later node by running it — never by declaring itself there. A jump is therefore always a move
 * back, and the guard runs before anything is sealed, so a refused jump writes nothing.
 */
export class JumpNotBackwards extends Error {
  readonly target: string;

  constructor(target: string) {
    super(`[model-builder] cannot jump to node "${target}": a jump only moves back`);
    this.name = "JumpNotBackwards";
    this.target = target;
  }
}
