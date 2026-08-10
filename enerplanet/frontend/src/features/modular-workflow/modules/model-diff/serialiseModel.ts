import type { ConfiguratorContext } from "../../types/context";

/**
 * Lightweight YAML serialiser for the shared workflow context.
 *
 * Produces a human-readable YAML document representing the current model
 * state. It handles the data types found in `ConfiguratorContext`:
 * primitives, plain objects, arrays, `Map`, and `Set`.
 *
 * This is intentionally a small, dependency-free implementation. It is not a
 * full YAML spec implementation — it targets the subset of values the context
 * holds. If richer YAML is needed later, swap this for `js-yaml`.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set)
  );
}

function scalarToString(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    // Quote strings that YAML would otherwise interpret as something else.
    const needsQuoting =
      value === "" ||
      /^[\s]|[\s]$/.test(value) ||
      /[:#{}&*!|>'"%@`]/.test(value) ||
      /^(true|false|null|yes|no|on|off|~)$/i.test(value) ||
      /^[-+]?\d/.test(value);
    if (needsQuoting) {
      return JSON.stringify(value);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "null";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function indentLines(lines: string[], spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return lines.map((line) => (line === "" ? line : pad + line));
}

function serialiseValue(value: unknown, depth: number): string[] {
  const pad = depth * 2;

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return ["{}"];
    const lines: string[] = [];
    for (const key of keys) {
      const child = value[key];
      if (child === undefined) continue;
      if (isPlainObject(child) || Array.isArray(child) || child instanceof Map || child instanceof Set) {
        lines.push(`${" ".repeat(pad)}${key}:`);
        lines.push(...serialiseValue(child, depth + 1));
      } else {
        lines.push(`${" ".repeat(pad)}${key}: ${scalarToString(child)}`);
      }
    }
    return lines;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return ["[]"];
    const lines: string[] = [];
    for (const item of value) {
      if (isPlainObject(item) || Array.isArray(item) || item instanceof Map || item instanceof Set) {
        lines.push(`${" ".repeat(pad)}-`);
        lines.push(...indentLines(serialiseValue(item, depth + 1), 2));
      } else {
        lines.push(`${" ".repeat(pad)}- ${scalarToString(item)}`);
      }
    }
    return lines;
  }

  if (value instanceof Map) {
    if (value.size === 0) return ["{}"];
    const lines: string[] = [];
    for (const [key, val] of value.entries()) {
      const keyStr = scalarToString(key);
      if (isPlainObject(val) || Array.isArray(val) || val instanceof Map || val instanceof Set) {
        lines.push(`${" ".repeat(pad)}${keyStr}:`);
        lines.push(...serialiseValue(val, depth + 1));
      } else {
        lines.push(`${" ".repeat(pad)}${keyStr}: ${scalarToString(val)}`);
      }
    }
    return lines;
  }

  if (value instanceof Set) {
    if (value.size === 0) return ["[]"];
    const lines: string[] = [];
    for (const item of value) {
      lines.push(`${" ".repeat(pad)}- ${scalarToString(item)}`);
    }
    return lines;
  }

  return [`${" ".repeat(pad)}${scalarToString(value)}`];
}

/**
 * Serialise the full model context into a YAML string.
 *
 * Derived/transient fields are excluded to keep the document focused on the
 * actual model state:
 * - `previousContext` — only used for diffing, not model data.
 * - `modelYaml` / `previousModelYaml` — the serialised YAML itself; including
 *   them would recursively nest the previous document inside the new one.
 * - `modelYamlEditMode` — transient UI state.
 */
export function serialiseModel(context: ConfiguratorContext): string {
  const {
    previousContext: _previousContext,
    modelYaml: _modelYaml,
    previousModelYaml: _previousModelYaml,
    modelYamlEditMode: _modelYamlEditMode,
    ...model
  } = context;
  const lines = serialiseValue(model, 0);
  return lines.join("\n");
}
