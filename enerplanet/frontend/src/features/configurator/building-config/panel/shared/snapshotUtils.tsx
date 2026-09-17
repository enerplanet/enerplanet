// Utilities for comparing current building state against the default estimate
// and classifying the result as 'default' or 'modified'.

import { cn } from '@spatialhub/ui';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import {
  DEFAULT_ELEMENTS,
  DEFAULT_GENERAL,
  DEFAULT_TOTAL_AREA,
  DEFAULT_AVG_U_VALUE,
  computeVolume,
} from './buildingDefaults';
import { BUILDING_TYPE_OPTIONS, COUNTRY_OPTIONS } from './buildingOptions';

export type SnapshotStatus = 'default' | 'modified';

/** Returns a Tailwind class string for the given snapshot status. */
export function getSnapshotStatusClassName(status: SnapshotStatus): string {
  return status === 'modified'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-slate-200 bg-slate-100 text-slate-600';
}

/** Returns true when two floats are equal within `epsilon`. */
export function isCloseTo(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Returns 'modified' if any property of `element` differs from its baseline.
 * When `baselineElement` is provided it is used directly; otherwise falls back
 * to the static DEFAULT_ELEMENTS lookup (used when no building has been loaded).
 */
export function getElementStatus(
  element: BuildingElement,
  baselineElement?: BuildingElement,
): SnapshotStatus {
  const def = baselineElement ?? DEFAULT_ELEMENTS[element.id];

  if (!def) return 'modified';

  const matches = isCloseTo(element.area, def.area)
    && isCloseTo(element.uValue, def.uValue)
    && isCloseTo(element.tilt, def.tilt)
    && isCloseTo(element.azimuth, def.azimuth)
    && (
      (element.gValue === null && def.gValue === null)
      || (element.gValue !== null && def.gValue !== null && isCloseTo(element.gValue, def.gValue))
    );

  return matches ? 'default' : 'modified';
}

/** Small pill badge showing whether a value matches or diverges from the estimate. */
export function SnapshotStatusBadge({ status }: { status: SnapshotStatus }) {
  return (
    <span className={cn(
      'inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold capitalize',
      getSnapshotStatusClassName(status),
    )}>
      {status}
    </span>
  );
}

// Maps area-weighted avg U-value to a human-readable thermal efficiency label.
export function getThermalRating(u: number): { label: string; color: string; bg: string } {
  if (u < 0.20) return { label: 'Excellent', color: '#059669', bg: '#ecfdf5' };
  if (u < 0.30) return { label: 'Good',      color: '#16a34a', bg: '#f0fdf4' };
  if (u < 0.50) return { label: 'Fair',      color: '#d97706', bg: '#fffbeb' };
  if (u < 0.80) return { label: 'Poor',      color: '#dc2626', bg: '#fef2f2' };
  return             { label: 'Very Poor',   color: '#9f1239', bg: '#fff1f2' };
}

export interface SnapshotRow {
  label: string;
  /** Formatted display string shown when not editing. */
  value: string;
  status: SnapshotStatus;
  /** When set, the row is inline-editable. Key maps to the `general` state object. */
  editKey?: string;
  /**
   * Controls the edit widget rendered for this row:
   * - 'text'   -> free-text input
   * - 'number' -> numeric input; saved as Number(draft)
   * - 'select' -> dropdown; requires `options`
   */
  editType?: 'text' | 'number' | 'select';
  /** Option list for 'select' rows. */
  options?: Array<{ value: string; label: string }>;
  /** Raw (unformatted) value used as the initial input value when editing starts. */
  rawValue?: string | number;
}

export interface SnapshotBaseline {
  general: typeof DEFAULT_GENERAL;
  elements: Record<string, BuildingElement>;
  totalArea: number;
  elementCount: number;
}

/**
 * Builds the rows for the building info table, flagging each value against the
 * baseline. When `baseline` is omitted the static defaults are used as the
 * reference point (no building data loaded yet).
 */
export function buildSnapshotRows(
  general: typeof DEFAULT_GENERAL,
  elements: Record<string, BuildingElement>,
  totalArea: number,
  baseline?: SnapshotBaseline,
): SnapshotRow[] {
  const baseGeneral      = baseline?.general      ?? DEFAULT_GENERAL;
  const baseTotalArea    = baseline?.totalArea    ?? DEFAULT_TOTAL_AREA;
  const baseElementCount = baseline?.elementCount ?? Object.keys(DEFAULT_ELEMENTS).length;

  return [
    {
      label: 'Type',
      value: general.buildingType,
      status: general.buildingType === baseGeneral.buildingType ? 'default' : 'modified',
      editKey: 'buildingType',
      editType: 'select',
      options: BUILDING_TYPE_OPTIONS,
      rawValue: general.buildingType,
    },
    {
      label: 'Construction year',
      value: String(general.constructionYear),
      status: general.constructionYear === baseGeneral.constructionYear ? 'default' : 'modified',
      editKey: 'constructionYear',
      editType: 'number',
      rawValue: general.constructionYear,
    },
    {
      label: 'Country',
      value: general.country,
      status: general.country === baseGeneral.country ? 'default' : 'modified',
      editKey: 'country',
      editType: 'select',
      options: COUNTRY_OPTIONS,
      rawValue: general.country,
    },
    {
      label: 'Floor area (per storey)',
      value: `${general.floorArea.toFixed(1)} m²`,
      status: isCloseTo(general.floorArea, baseGeneral.floorArea) ? 'default' : 'modified',
      editKey: 'floorArea',
      editType: 'number',
      rawValue: general.floorArea,
    },
    {
      label: 'Storeys',
      value: `${general.storeys}`,
      status: general.storeys === baseGeneral.storeys ? 'default' : 'modified',
      editKey: 'storeys',
      editType: 'number',
      rawValue: general.storeys,
    },
    {
      label: 'Room height',
      value: `${general.roomHeight.toFixed(1)} m`,
      status: isCloseTo(general.roomHeight, baseGeneral.roomHeight) ? 'default' : 'modified',
      editKey: 'roomHeight',
      editType: 'number',
      rawValue: general.roomHeight,
    },
    {
      label: 'Volume',
      value: `${computeVolume(general.floorArea, general.storeys, general.roomHeight).toFixed(0)} m³`,
      status: isCloseTo(general.floorArea, baseGeneral.floorArea)
        && general.storeys === baseGeneral.storeys
        && isCloseTo(general.roomHeight, baseGeneral.roomHeight)
        ? 'default'
        : 'modified',
    },
    {
      label: 'Envelope',
      value: `${totalArea.toFixed(1)} m²  ·  ${Object.keys(elements).length} surfaces`,
      status: isCloseTo(totalArea, baseTotalArea)
        && Object.keys(elements).length === baseElementCount
        ? 'default'
        : 'modified',
    },
  ];
}

/** Returns the snapshot status for the overall thermal efficiency metric. */
export function getThermalEfficiencyStatus(avgUValue: number): SnapshotStatus {
  return isCloseTo(avgUValue, DEFAULT_AVG_U_VALUE) ? 'default' : 'modified';
}
