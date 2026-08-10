/**
 * Lightweight line-based diff engine.
 *
 * Computes a unified-style diff between two YAML strings (or any two
 * multi-line strings) using a longest-common-subsequence (LCS) approach.
 * Returns a list of lines tagged as `"added"`, `"removed"`, or `"unchanged"`.
 *
 * This is a small, dependency-free implementation. If a richer diff is needed
 * later (word-level, side-by-side), swap this for the `diff` package.
 */

export type DiffLineType = "added" | "removed" | "unchanged";

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Compute the LCS length table between two arrays of lines.
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        table[i][j] = table[i + 1][j + 1] + 1;
      } else {
        table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
  }
  return table;
}

/**
 * Reconstruct the diff from the LCS table.
 */
function backtrack(a: string[], b: string[], table: number[][]): DiffLine[] {
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: "unchanged", text: a[i] });
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ type: "removed", text: a[i] });
      i++;
    } else {
      result.push({ type: "added", text: b[j] });
      j++;
    }
  }

  while (i < a.length) {
    result.push({ type: "removed", text: a[i] });
    i++;
  }
  while (j < b.length) {
    result.push({ type: "added", text: b[j] });
    j++;
  }

  return result;
}

/**
 * Compute a line-based diff between two strings.
 *
 * @param before The previous YAML (or empty string).
 * @param after  The current YAML.
 * @returns An array of `DiffLine` entries in document order.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.length > 0 ? before.split("\n") : [];
  const b = after.length > 0 ? after.split("\n") : [];

  if (a.length === 0 && b.length === 0) return [];

  const table = lcsTable(a, b);
  return backtrack(a, b, table);
}

/**
 * Count the number of added and removed lines in a diff.
 */
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "added") added++;
    else if (line.type === "removed") removed++;
  }
  return { added, removed };
}
