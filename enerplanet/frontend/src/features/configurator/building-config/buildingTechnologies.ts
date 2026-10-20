/**
 * The technologies installed on one building, as the cards the 3D view's
 * Technologies tab shows, and the edits those cards make. Edits change the
 * building's own constraint values, never the catalogue product.
 */

import type { TechCard, TechField } from '@thd-spatial-ai/building-configurator';

import { KWP_PER_M2, type PvArray } from './usePvMode';

interface Constraint {
  key: string;
  value: unknown;
}

/** One technology as stored in a building's `techs` property. */
export interface BuildingTech {
  alias?: string;
  constraints?: Constraint[];
  arrays?: PvArray[] | null;
  [extra: string]: unknown;
}

export type BuildingTechs = Record<string, BuildingTech>;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A card field: its constraint, label key, unit, and whether "no limit" is allowed. */
interface FieldSpec {
  key: string;
  label: 'size' | 'power' | 'energy' | 'cop' | 'efficiency' | 'investment' | 'price';
  unit: string;
  unbounded?: boolean;
  /** Efficiencies must be above zero; every other value may be zero. */
  positive?: boolean;
}

const SIZE: FieldSpec = { key: 'cont_energy_cap_max', label: 'size', unit: 'kW', unbounded: true };
const COP: FieldSpec = { key: 'cont_energy_eff', label: 'cop', unit: '', positive: true };
const EFFICIENCY: FieldSpec = { key: 'cont_energy_eff', label: 'efficiency', unit: '', positive: true };
const INVESTMENT_KW: FieldSpec = { key: 'cost_energy_cap', label: 'investment', unit: 'EUR/kW' };

const FIELDS: Record<string, FieldSpec[]> = {
  pv_supply: [INVESTMENT_KW],
  battery_storage: [
    { ...SIZE, label: 'power' },
    { key: 'cont_storage_cap_max', label: 'energy', unit: 'kWh', unbounded: true },
    { key: 'cost_storage_cap', label: 'investment', unit: 'EUR/kWh' },
  ],
  air_source_heat_pump: [SIZE, COP, INVESTMENT_KW],
  ground_source_heat_pump: [SIZE, COP, INVESTMENT_KW],
  air_conditioner: [SIZE, COP, INVESTMENT_KW],
  electric_boilers: [SIZE, EFFICIENCY, INVESTMENT_KW],
  gas_boiler: [SIZE, EFFICIENCY, INVESTMENT_KW],
  gas_supply: [{ key: 'cost_om_con', label: 'price', unit: 'EUR/kWh' }],
};

/** Fields of a technology type this list does not know: its size and investment. */
const DEFAULT_FIELDS = [SIZE, INVESTMENT_KW];

const UNBOUNDED = 'INF';

/** A stored constraint value as a card value: "INF" is unbounded (null). */
function cardValue(raw: unknown): number | null | undefined {
  if (raw === UNBOUNDED || raw === null) return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** kWp of the PV arrays, each its usable area at KWP_PER_M2 unless it sets its own capacity. */
export function pvCapacityKw(arrays: readonly (PvArray & { capacity_kw?: number })[]): number {
  return arrays.reduce((sum, a) => sum + (a.capacity_kw ?? a.area * a.usable_share * KWP_PER_M2), 0);
}

/** Edits are refused per field; the message is shown under it until a valid value arrives. */
export type FieldErrors = Record<string, string>;

/** Key of one field's error in FieldErrors. */
export const errorKey = (techKey: string, fieldKey: string) => `${techKey}:${fieldKey}`;

/**
 * One card per installed technology. pvArrays are the arrays PV covers now:
 * the stored ones, or the qualifying roofs while placement is automatic.
 */
export function technologyCards(
  techs: BuildingTechs,
  pvArrays: readonly PvArray[],
  runMode: 'plan' | 'operate',
  errors: FieldErrors,
  t: Translate,
): Omit<TechCard, 'action'>[] {
  return Object.entries(techs).map(([techKey, tech]) => {
    const fields: TechField[] = [];
    if (techKey === 'pv_supply') {
      fields.push({ key: 'capacity', label: t('buildingConfig.tech.pvCapacity'), value: round(pvCapacityKw(pvArrays)), unit: 'kWp' });
    }
    for (const spec of FIELDS[techKey] ?? DEFAULT_FIELDS) {
      const value = cardValue(tech.constraints?.find((c) => c.key === spec.key)?.value);
      if (value === undefined) continue;
      const label = spec.unbounded && runMode === 'plan' ? `${spec.label}Max` : spec.label;
      fields.push({
        key: spec.key,
        label: t(`buildingConfig.tech.${label}`),
        value,
        unit: spec.unit || undefined,
        editable: true,
        min: 0,
        error: errors[errorKey(techKey, spec.key)],
      });
    }
    const title = t(`technologies.types.${techKey}`, { defaultValue: tech.alias ?? techKey });
    return { id: techKey, title, subtitle: tech.alias && tech.alias !== title ? tech.alias : undefined, fields };
  });
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Sets one constraint of one technology. Returns the new techs, or the reason
 * the value is refused: a cleared input means "no limit", allowed only for sizes.
 */
export function setTechField(
  techs: BuildingTechs,
  techKey: string,
  fieldKey: string,
  value: number | null,
  t: Translate,
): { techs: BuildingTechs } | { error: string } {
  const tech = techs[techKey];
  const spec = (FIELDS[techKey] ?? DEFAULT_FIELDS).find((f) => f.key === fieldKey);
  if (!tech || !spec) return { error: t('buildingConfig.tech.notEditable') };
  if (value === null && !spec.unbounded) return { error: t('buildingConfig.tech.required') };
  if (value !== null && (value < 0 || (spec.positive && value === 0))) {
    return { error: t(spec.positive ? 'buildingConfig.tech.positive' : 'buildingConfig.tech.notNegative') };
  }
  const stored = value === null ? UNBOUNDED : value;
  const constraints = (tech.constraints ?? []).map((c) => (c.key === fieldKey ? { ...c, value: stored } : c));
  return { techs: { ...techs, [techKey]: { ...tech, constraints } } };
}

/** The techs without techKey. */
export function removeTech(techs: BuildingTechs, techKey: string): BuildingTechs {
  const next = { ...techs };
  delete next[techKey];
  return next;
}

