/**
 * Context serialization (Plan P1/P7).
 *
 * The whole context is JSON-serializable — this is both the backend save
 * payload source and the isolation-mode `.enerplanet.json` download format.
 */
import type { ModelContext } from "./types";

export const CONTEXT_FILE_EXT = ".enerplanet.json";
export const CONTEXT_FILE_VERSION = 1;

interface ContextFile {
  format: "enerplanet-context";
  version: number;
  context: ModelContext;
}

export function serializeContext(ctx: ModelContext): string {
  const file: ContextFile = {
    format: "enerplanet-context",
    version: CONTEXT_FILE_VERSION,
    context: ctx,
  };
  return JSON.stringify(file, null, 2);
}

/** Parse and validate a serialized context. Throws on malformed input. */
export function deserializeContext(json: string): ModelContext {
  const file = JSON.parse(json) as Partial<ContextFile>;
  if (file.format !== "enerplanet-context" || typeof file.context !== "object" || !file.context) {
    throw new Error("Not an enerplanet context file");
  }
  if (file.version !== CONTEXT_FILE_VERSION) {
    throw new Error(`Unsupported context file version: ${file.version}`);
  }
  const ctx = file.context;
  if (ctx.schemaVersion !== 1 || typeof ctx.revision !== "number") {
    throw new Error("Context schema mismatch");
  }
  return ctx;
}

/** Suggested download filename for a context. */
export function contextFilename(ctx: ModelContext): string {
  const slug = (ctx.meta.title || "model")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "model"}${ctx.id ? `-${ctx.id}` : ""}${CONTEXT_FILE_EXT}`;
}
