export const KEY_RE: RegExp;
export const PREFIX_RE: RegExp;
export const PLURAL_SUFFIXES: readonly string[];

export function stripPlural(key: string): string;
export function walk(dir: string, out?: string[]): string[];
export function walkText(dir: string, out?: string[]): string[];
export function uiSourceFiles(...dirs: string[]): string[];
export function referenceText(...dirs: string[]): string[];

export interface ScanResult {
  staticKeys: Set<string>;
  dynPrefixes: Set<string>;
}
export function scanSource(...uiDirs: string[]): ScanResult;

export interface LocaleData {
  file: string;
  path: string;
  json: Record<string, unknown>;
  keys: Set<string>;
}
export function loadLocales(localesDir: string): LocaleData[];
export function flatten(obj: Record<string, unknown>, prefix?: string, acc?: string[]): string[];

export interface AppScope {
  uiDirs: string[];
  textDirs: string[];
}
export function appDirs(frontendRoot: string): AppScope;

export interface I18nScope extends AppScope {
  staticKeys: Set<string>;
  dynPrefixes: Set<string>;
  sourceText: string;
}
export function i18nScope(frontendRoot: string): I18nScope;

export function usedKeySet(
  staticKeys: Set<string>,
  dynPrefixes: Set<string>,
  sourceText: string
): (key: string) => boolean;
export function computeUnusedKeys(
  staticKeys: Set<string>,
  dynPrefixes: Set<string>,
  sourceText: string,
  localeKeys: Set<string>
): string[];
