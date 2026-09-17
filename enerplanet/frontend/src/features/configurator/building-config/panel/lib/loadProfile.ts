// Shared load profile data model and pure transformation helpers.

import { strToU8, zipSync } from 'fflate';

export type EnergyType = 'electricity' | 'heating' | 'hotwater' | 'dhw' | 'kitchen' | 'combined';
export type Resolution = 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface LoadDataPoint {
  timestamp: string;
  electricity: number;
  heating: number;
  hotwater: number;
  /** Domestic hot water, kWh — real per-hour data (v6-draft), unlike `hotwater` above which is actually cooling. 0 on sources predating it (older BuEM runs, CSV uploads without a matching column). */
  dhw: number;
  /** Cooking gas demand, kWh_gas — a different fuel channel, not summed with the electric/thermal series above. */
  kitchen: number;
}

/**
 * Where a displayed total actually came from — undefined/'buem' means "the
 * last confirmed full simulation", the ordinary/default state that needs no
 * tag. 'ignis' is a fast live estimate (heating only — ignis has no
 * electricity/cooling model). 'user' is an uploaded load profile, treated
 * as ground truth: it outranks both models as the number to trust.
 */
export type EnergySource = 'ignis' | 'buem' | 'user';

export interface EnergyTotals {
  electricity: string;
  heating: string;
  hotwater: string;
  /** Domestic hot water — BuEM's v6-draft hot_water total; '—' when unavailable (e.g. an uploaded profile with no model run behind it). */
  dhw?: string;
  /** Cooking gas demand, in kitchenUnit (kWh_gas) rather than the electric unit below. */
  kitchen?: string;
  /** heating + cooling + electricity + dhw — gas (kitchen) deliberately excluded, same choice BuEM itself makes. */
  total?: string;
  unit: string;
  /** Overrides `unit` for the kitchen row only, since it's a gas total, not electric kWh. */
  kitchenUnit?: string;
  heatingSource?: EnergySource;
  electricitySource?: EnergySource;
  hotwaterSource?: EnergySource;
  /** % difference between the displayed figure and the comparison reference named below, when one exists. */
  heatingDeltaPercent?: number | null;
  electricityDeltaPercent?: number | null;
  hotwaterDeltaPercent?: number | null;
  /** ignis's raw per-area annual heating figure (kWh/(m²·a)), shown alongside the total. */
  heatingPerM2?: string;
  /** Formatted comparison-reference total (kWh) and what to call it in the sentence. */
  heatingBaselineKwh?: string;
  heatingComparisonLabel?: string;
  electricityBaselineKwh?: string;
  electricityComparisonLabel?: string;
  hotwaterBaselineKwh?: string;
  hotwaterComparisonLabel?: string;
}

export type DatasetByResolution = Record<Resolution, LoadDataPoint[]>;

export interface DerivedDataState {
  rows: LoadDataPoint[];
  sourceResolution: Resolution | null;
  isDerived: boolean;
}

export const RESOLUTIONS: Resolution[] = ['hourly', 'daily', 'weekly', 'monthly'];
export const RESOLUTION_ORDER: Resolution[] = ['hourly', 'daily', 'weekly', 'monthly'];

const BASE_UTC_DATE = Date.UTC(2026, 0, 5, 0, 0, 0);
const TIMESTAMP_HEADERS = ['datetime', 'timestamp', 'time', 'date', 'timesteps', 'zeit'];
const ELECTRICITY_HEADERS = ['electricity', 'power', 'el'];
const HEATING_HEADERS = ['heating', 'heat'];
const HOTWATER_HEADERS = ['hotwater', 'hot_water', 'hot water', 'dhw'];

function clampNumber(value: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Number(value.toFixed(6));
}

function toIsoString(date: Date) {
  return date.toISOString().replace('.000Z', 'Z');
}

function offsetIsoDate(baseUtc: number, amount: number, unit: 'hour' | 'day' | 'week' | 'month') {
  const date = new Date(baseUtc);

  if (unit === 'hour') date.setUTCHours(date.getUTCHours() + amount);
  if (unit === 'day') date.setUTCDate(date.getUTCDate() + amount);
  if (unit === 'week') date.setUTCDate(date.getUTCDate() + amount * 7);
  if (unit === 'month') date.setUTCMonth(date.getUTCMonth() + amount);

  return toIsoString(date);
}

function resolutionUnit(resolution: Resolution): 'hour' | 'day' | 'week' | 'month' {
  if (resolution === 'hourly') return 'hour';
  if (resolution === 'daily') return 'day';
  if (resolution === 'weekly') return 'week';
  return 'month';
}

function normalizeDatetime(value: unknown, fallback: string, resolution: Resolution, index: number) {
  if (typeof value !== 'string' || value.trim() === '') return fallback;

  const trimmed = value.trim();

  if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const [hours, minutes, seconds = '00'] = trimmed.split(':');
    const date = new Date(BASE_UTC_DATE);
    date.setUTCHours(Number(hours), Number(minutes), Number(seconds), 0);
    if (resolution !== 'hourly') {
      const offsetUnit = resolutionUnit(resolution);
      if (offsetUnit === 'day') date.setUTCDate(date.getUTCDate() + index);
      if (offsetUnit === 'week') date.setUTCDate(date.getUTCDate() + index * 7);
      if (offsetUnit === 'month') date.setUTCMonth(date.getUTCMonth() + index);
    }
    return toIsoString(date);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid datetime value: ${value}`);
  }

  return toIsoString(parsed);
}

function normalizePoint(input: unknown, index: number, resolution: Resolution = 'hourly'): LoadDataPoint | null {
  if (!input || typeof input !== 'object') return null;

  const raw = input as Record<string, unknown>;
  const fallback = offsetIsoDate(BASE_UTC_DATE, index, 'hour');
  const pointResolution = (raw.resolution as Resolution | undefined) ?? resolution;
  const timestamp = normalizeDatetime(
    raw.datetime ?? raw.timestamp ?? raw.time ?? raw.date ?? raw.timesteps ?? raw.Zeit,
    fallback,
    pointResolution,
    index,
  );
  const electricity = Number(raw.electricity ?? raw.power ?? raw.el ?? 0);
  const heating = Number(raw.heating ?? raw.heat ?? 0);
  const hotwater = Number(raw.hotwater ?? raw.hotWater ?? raw.dhw ?? 0);

  if ([electricity, heating, hotwater].some((value) => Number.isNaN(value))) {
    return null;
  }

  return {
    timestamp,
    electricity: clampNumber(electricity),
    heating: clampNumber(heating),
    hotwater: clampNumber(hotwater),
    // No CSV/JSON upload column for these yet; only a live BuEM run
    // populates real dhw/kitchen per-hour data (see heatService.ts).
    dhw: 0,
    kitchen: 0,
  };
}

function normalizeSeries(input: unknown, resolution: Resolution = 'hourly'): LoadDataPoint[] {
  if (!Array.isArray(input)) {
    throw new Error('Expected an array of load profile rows.');
  }

  const rows = input
    .map((entry, index) => normalizePoint(entry, index, resolution))
    .filter((entry): entry is LoadDataPoint => entry !== null);

  if (rows.length === 0) {
    throw new Error('The file did not contain any valid load profile rows.');
  }

  return rows;
}

function startOfUtcBucket(timestamp: string, resolution: Exclude<Resolution, 'hourly'>) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  const bucket = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
  ));

  if (resolution === 'weekly') {
    const day = bucket.getUTCDay();
    const offsetToMonday = day === 0 ? -6 : 1 - day;
    bucket.setUTCDate(bucket.getUTCDate() + offsetToMonday);
  }

  if (resolution === 'monthly') {
    bucket.setUTCDate(1);
  }

  return toIsoString(bucket);
}

/** Formats a numeric energy value for axis labels, tooltips, and summary totals. */
export function formatEnergyValue(value: number, maximumFractionDigits = 4) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return '0';

  const absValue = Math.abs(value);

  if (absValue === 0) return '0';
  if (absValue >= 100) return value.toFixed(0);
  if (absValue >= 10) return value.toFixed(1);
  if (absValue >= 1) return value.toFixed(2);
  if (absValue >= 0.1) return value.toFixed(Math.min(maximumFractionDigits, 3));
  if (absValue >= 0.01) return value.toFixed(Math.min(maximumFractionDigits, 4));
  return value.toFixed(Math.min(maximumFractionDigits, 6));
}

/** Formats a timestamp for the active chart resolution. */
export function formatTickLabel(timestamp: string, resolution: Resolution) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;

  if (resolution === 'hourly') {
    return date.toISOString().slice(11, 16);
  }

  if (resolution === 'daily' || resolution === 'weekly') {
    return date.toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 7);
}

/** Converts an ISO timestamp into a UTC date key used by the hourly day picker. */
/** Aggregates a finer-grained series into daily, weekly, or monthly buckets. */
export function aggregateSeries(data: LoadDataPoint[], resolution: Exclude<Resolution, 'hourly'>): LoadDataPoint[] {
  const buckets = new Map<string, LoadDataPoint>();

  data
    .slice()
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .forEach((point) => {
      const bucketTimestamp = startOfUtcBucket(point.timestamp, resolution);
      const existing = buckets.get(bucketTimestamp);

      if (existing) {
        existing.electricity = clampNumber(existing.electricity + point.electricity);
        existing.heating = clampNumber(existing.heating + point.heating);
        existing.hotwater = clampNumber(existing.hotwater + point.hotwater);
        existing.dhw = clampNumber(existing.dhw + point.dhw);
        existing.kitchen = clampNumber(existing.kitchen + point.kitchen);
        return;
      }

      buckets.set(bucketTimestamp, {
        timestamp: bucketTimestamp,
        electricity: clampNumber(point.electricity),
        heating: clampNumber(point.heating),
        hotwater: clampNumber(point.hotwater),
        dhw: clampNumber(point.dhw),
        kitchen: clampNumber(point.kitchen),
      });
    });

  return Array.from(buckets.values());
}

/** Returns the direct dataset for a resolution or derives one from the finest available source. */
export function getDerivedData(dataset: DatasetByResolution, resolution: Resolution): DerivedDataState {
  const directRows = dataset[resolution];

  if (directRows.length > 0) {
    return { rows: directRows, sourceResolution: resolution, isDerived: false };
  }

  if (resolution === 'hourly') {
    return { rows: [], sourceResolution: null, isDerived: false };
  }

  const targetIndex = RESOLUTION_ORDER.indexOf(resolution);

  for (let index = 0; index < targetIndex; index += 1) {
    const sourceResolution = RESOLUTION_ORDER[index];
    const sourceRows = dataset[sourceResolution];

    if (sourceRows.length === 0) continue;

    return {
      rows: aggregateSeries(sourceRows, resolution),
      sourceResolution,
      isDerived: true,
    };
  }

  return { rows: [], sourceResolution: null, isDerived: false };
}

/**
 * Picks the rows an upload just added, by finding which resolution's array
 * changed between the dataset before and after — used to turn an uploaded
 * load profile into ground-truth annual totals. Deliberately does NOT just
 * grab the finest non-empty resolution in the new dataset: the model output
 * already sitting in `hourly` would always win over whatever resolution the
 * user's file actually was, since a file upload never touches `hourly`
 * unless the upload itself was hourly.
 */
export function pickUpdatedRows(previous: DatasetByResolution, next: DatasetByResolution): LoadDataPoint[] | null {
  for (const resolution of RESOLUTION_ORDER) {
    if (next[resolution] !== previous[resolution] && next[resolution].length > 0) return next[resolution];
  }
  return null;
}

/** Creates the empty per-resolution dataset state used by the viewer. */
export function createDefaultDataset(): DatasetByResolution {
  const hourly: LoadDataPoint[] = [];
  const daily: LoadDataPoint[] = [];
  const weekly: LoadDataPoint[] = [];
  const monthly: LoadDataPoint[] = [];

  return { hourly, daily, weekly, monthly };
}

/** Parses a CSV upload into a normalized load profile for the selected resolution. */
export function parseCsv(text: string, resolution: Resolution): LoadDataPoint[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSV files need a header row and at least one data row.');
  }

  const headers = lines[0]
    .split(',')
    .map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
  const timestampIndex = headers.findIndex((header) => TIMESTAMP_HEADERS.includes(header));
  const electricityIndex = headers.findIndex((header) => ELECTRICITY_HEADERS.includes(header));
  const heatingIndex = headers.findIndex((header) => HEATING_HEADERS.includes(header));
  const hotwaterIndex = headers.findIndex((header) => HOTWATER_HEADERS.includes(header));

  if (timestampIndex === -1) {
    throw new Error('CSV files must include a timestamp column.');
  }

  const rows = lines.slice(1).map((line, index) => {
    const cols = line.split(',').map((value) => value.trim());
    return normalizePoint({
      datetime: cols[timestampIndex],
      electricity: electricityIndex >= 0 ? cols[electricityIndex] : 0,
      heating: heatingIndex >= 0 ? cols[heatingIndex] : 0,
      hotwater: hotwaterIndex >= 0 ? cols[hotwaterIndex] : 0,
    }, index, resolution);
  }).filter((entry): entry is LoadDataPoint => entry !== null);

  if (rows.length === 0) {
    throw new Error('The CSV file did not contain any valid load profile rows.');
  }

  return rows;
}

/** One CSV column per downloadable profile: LoadDataPoint key, header label, and file name stem. */
const PROFILE_COLUMNS: { key: 'heating' | 'hotwater' | 'electricity'; label: string; file: string }[] = [
  { key: 'heating', label: 'heating', file: 'heating' },
  { key: 'hotwater', label: 'cooling', file: 'cooling' },
  { key: 'electricity', label: 'electricity', file: 'electricity' },
];

function toProfileCsv(
  data: LoadDataPoint[],
  resolution: Resolution,
  key: 'heating' | 'hotwater' | 'electricity',
  label: string,
) {
  const header = `datetime,${label}`;
  const rows = data.map((row, index) => [
    normalizeDatetime(row.timestamp, offsetIsoDate(BASE_UTC_DATE, index, resolutionUnit(resolution)), resolution, index),
    row[key],
  ].join(','));

  return [header, ...rows].join('\n');
}

/** Zips the heating, cooling, and electricity profiles as separate CSVs for download. */
export function toProfileZip(data: LoadDataPoint[], resolution: Resolution): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { key, label, file } of PROFILE_COLUMNS) {
    files[`${file}-${resolution}.csv`] = strToU8(toProfileCsv(data, resolution, key, label));
  }
  return zipSync(files);
}

/** Merges uploaded JSON content into the existing per-resolution dataset state. */
export function mergeUploadedData(
  previous: DatasetByResolution,
  uploaded: unknown,
  resolution: Resolution,
): DatasetByResolution {
  if (Array.isArray(uploaded)) {
    return { ...previous, [resolution]: normalizeSeries(uploaded, resolution) };
  }

  if (!uploaded || typeof uploaded !== 'object') {
    throw new Error('Unsupported JSON format.');
  }

  const record = uploaded as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    const targetResolution = RESOLUTIONS.includes(record.resolution as Resolution)
      ? record.resolution as Resolution
      : resolution;
    return { ...previous, [targetResolution]: normalizeSeries(record.data, targetResolution) };
  }

  let hasAtLeastOneSeries = false;
  const next = { ...previous };

  RESOLUTIONS.forEach((key) => {
    if (Array.isArray(record[key])) {
      next[key] = normalizeSeries(record[key], key);
      hasAtLeastOneSeries = true;
    }
  });

  if (!hasAtLeastOneSeries) {
    throw new Error('JSON files must contain either a data array or one or more resolution arrays.');
  }

  return next;
}