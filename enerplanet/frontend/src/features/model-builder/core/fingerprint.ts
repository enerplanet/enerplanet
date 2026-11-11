/**
 * A stable, value-based fingerprint of a store value.
 *
 * Two things it must get right:
 * - **key order does not matter** — the DB and the code can disagree on it (the legacy
 *   save path needed a workaround for exactly this),
 * - **array order does** — a list of features is ordered.
 *
 * This is the comparison elision uses to decide "nothing changed" (T20) and the artefact
 * check uses to notice that a stored projection and its log disagree (T18).
 */

/** Deterministic string for any JSON-safe store value. */
export function fingerprint(value: unknown): string {
  return stableStringify(value, new Set());
}

function stableStringify(value: unknown, seen: Set<unknown>): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "bigint":
      return `${value.toString()}n`;
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item, seen)).join(",")}]`;
  }

  if (typeof value === "object") {
    if (seen.has(value)) return '"[circular]"';
    seen.add(value);

    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key], seen)}`)
      .join(",");

    seen.delete(value);
    return `{${body}}`;
  }

  // Functions and symbols are not store values; keep the function total rather than throwing.
  return String(value);
}
