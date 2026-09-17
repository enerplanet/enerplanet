import type { ModelDataPath } from './modelDataMap';

function getValueAtSinglePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, source);
}

/** Resolves a mapped path, trying fallbacks in order when an array is provided. */
export function getMappedValue<T = unknown>(source: unknown, path: ModelDataPath): T | undefined {
  const paths = Array.isArray(path) ? path : [path];

  for (const candidate of paths) {
    const value = getValueAtSinglePath(source, candidate);
    if (value !== undefined && value !== null) {
      return value as T;
    }
  }

  return undefined;
}

/** Returns an array from a mapped path, or an empty array when the value is absent. */
export function getMappedArray(source: unknown, path: ModelDataPath): unknown[] {
  const value = getMappedValue<unknown>(source, path);
  return Array.isArray(value) ? value : [];
}

/** Returns an object record from a mapped path, or an empty record when missing. */
export function getMappedRecord(source: unknown, path: ModelDataPath): Record<string, unknown> {
  const value = getMappedValue<unknown>(source, path);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Reads a numeric value from either a plain number field or a { value, unit } quantity object. */
export function getMappedNumber(source: unknown, path: ModelDataPath, fallback = 0): number {
  const value = getMappedValue<unknown>(source, path);

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value && typeof value === 'object' && 'value' in value) {
    const n = Number((value as { value: unknown }).value);
    return Number.isFinite(n) ? n : fallback;
  }

  return fallback;
}

/** Returns true when at least one mapped path resolves to a non-null value. */
export function hasMappedValue(source: unknown, path: ModelDataPath): boolean {
  return getMappedValue(source, path) !== undefined;
}