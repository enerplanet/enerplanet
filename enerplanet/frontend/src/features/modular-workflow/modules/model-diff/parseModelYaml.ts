/**
 * Minimal YAML parser for the model-diff editor.
 *
 * Parses the subset of YAML produced by `serialiseModel` back into a plain
 * object so edits can be validated and merged into the context. It reports
 * line-level errors for malformed input.
 *
 * Supported constructs:
 *   - `key: value` mappings (nested via indentation)
 *   - `- item` sequences
 *   - scalar values: strings (optionally quoted), numbers, booleans, null
 *   - `{}` and `[]` empty containers
 *
 * This is intentionally small and dependency-free. It is not a full YAML
 * parser — it targets the serialiser's output shape.
 */

export interface YamlParseError {
  line: number;
  message: string;
}

export interface YamlParseResult {
  ok: boolean;
  value?: Record<string, unknown>;
  errors: YamlParseError[];
}

interface Token {
  indent: number;
  line: number;
  text: string;
}

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    tokens.push({ indent, line: i + 1, text: raw.trim() });
  }
  return tokens;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[-+]?\d+$/.test(value)) return Number(value);
  if (/^[-+]?\d*\.\d+$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a mapping/sequence block starting at `index` with the given indent.
 * Returns the parsed value and the next token index.
 */
function parseBlock(
  tokens: Token[],
  index: number,
  indent: number,
  errors: YamlParseError[],
): { value: unknown; next: number } {
  if (index >= tokens.length) return { value: null, next: index };

  const token = tokens[index];
  if (token.indent < indent) return { value: null, next: index };

  // Sequence block
  if (token.text.startsWith("-")) {
    const items: unknown[] = [];
    let i = index;
    while (i < tokens.length && tokens[i].indent === indent && tokens[i].text.startsWith("-")) {
      const rest = tokens[i].text.slice(1).trim();
      if (rest === "") {
        // Nested block under the dash
        const child = parseBlock(tokens, i + 1, indent + 2, errors);
        items.push(child.value);
        i = child.next;
      } else if (rest.includes(":")) {
        // Inline mapping item: "- key: value"
        const colon = rest.indexOf(":");
        const key = rest.slice(0, colon).trim();
        const valRaw = rest.slice(colon + 1).trim();
        const obj: Record<string, unknown> = {};
        if (valRaw === "") {
          const child = parseBlock(tokens, i + 1, indent + 2, errors);
          obj[key] = child.value;
          i = child.next;
        } else {
          obj[key] = parseScalar(valRaw);
          i++;
        }
        items.push(obj);
      } else {
        items.push(parseScalar(rest));
        i++;
      }
    }
    return { value: items, next: i };
  }

  // Mapping block
  const obj: Record<string, unknown> = {};
  let i = index;
  while (i < tokens.length && tokens[i].indent === indent) {
    const text = tokens[i].text;
    if (text.startsWith("-")) break;
    const colon = text.indexOf(":");
    if (colon === -1) {
      errors.push({ line: tokens[i].line, message: `Expected "key: value" but found "${text}"` });
      i++;
      continue;
    }
    const key = text.slice(0, colon).trim();
    const valRaw = text.slice(colon + 1).trim();
    if (valRaw === "") {
      const child = parseBlock(tokens, i + 1, indent + 2, errors);
      obj[key] = child.value;
      i = child.next;
    } else {
      obj[key] = parseScalar(valRaw);
      i++;
    }
  }
  return { value: obj, next: i };
}

/**
 * Parse a YAML string into a plain object, reporting line-level errors.
 */
export function parseModelYaml(source: string): YamlParseResult {
  const errors: YamlParseError[] = [];
  const tokens = tokenise(source);

  if (tokens.length === 0) {
    return { ok: true, value: {}, errors };
  }

  const rootIndent = tokens[0].indent;
  const { value, next } = parseBlock(tokens, 0, rootIndent, errors);

  if (next < tokens.length) {
    errors.push({
      line: tokens[next].line,
      message: `Unexpected content at inconsistent indentation: "${tokens[next].text}"`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      errors: [{ line: 1, message: "Root of the model YAML must be a mapping" }],
    };
  }

  return { ok: true, value: value as Record<string, unknown>, errors };
}
