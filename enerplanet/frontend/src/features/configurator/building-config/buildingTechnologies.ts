/**
 * The technologies installed on one building, as the cards the 3D view's
 * Technologies tab shows, and the edits those cards make. Edits change the
 * building's own constraint values, never the catalogue product.
 */

import type { TechCard, TechField, Technologies } from '@thd-spatial-ai/building-configurator';

import { defaultConstraints, defaultProduct, productsOfType } from '@/features/technologies/catalogue';
import type { Technology } from '@/features/technologies/services/technologyService';
import { formatNumber } from '@/utils/formatNumber';

import type { PvArray } from './usePvMode';

interface Constraint {
  key: string;
  value: unknown;
}

/** One technology as stored in a building's `techs` property. */
export interface BuildingTech {
  alias?: string;
  icon?: string;
  /** The catalogue product it was chosen from; absent for the type's default product. */
  product?: string;
  constraints?: Constraint[];
  arrays?: PvArray[] | null;
  [extra: string]: unknown;
}

export type BuildingTechs = Record<string, BuildingTech>;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A card field: its constraint, label key, unit, and whether "no limit" is allowed. */
interface FieldSpec {
  key: string;
  /** A buildingConfig.tech label key for the headline fields; the others take the parameter's name. */
  label?: 'size' | 'power' | 'energy' | 'cop' | 'efficiency' | 'investment' | 'price';
  unit: string;
  unbounded?: boolean;
  /** Efficiencies must be above zero; every other value may be zero. */
  positive?: boolean;
  /** The catalogue's limits; the lower one is 0 when it gives none. */
  min?: number;
  max?: number;
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

// Each size with its investment cost per unit. A gas price (cost_om_con) is per kWh used, not an investment.
const COST_OF_SIZE: [size: string, cost: string, unit: string][] = [
  ['cont_energy_cap_max', 'cost_energy_cap', 'EUR/kW'],
  ['cont_storage_cap_max', 'cost_storage_cap', 'EUR/kWh'],
];

/** A card's investment: each priced size times its cost, or only the rates while a size is left open. */
function investmentOf(tech: BuildingTech): TechCard['investment'] {
  const valueOf = (key: string) => cardValue(tech.constraints?.find((c) => c.key === key)?.value);
  const priced = COST_OF_SIZE.flatMap(([sizeKey, costKey, unit]) => {
    const size = valueOf(sizeKey);
    const cost = valueOf(costKey);
    return size === undefined || typeof cost !== 'number' ? [] : [{ size, cost, unit }];
  });
  if (priced.length === 0) return undefined;
  if (priced.some((p) => p.size === null)) {
    return { amount: null, currency: 'EUR', rate: priced.map((p) => `${formatNumber(p.cost)} ${p.unit}`).join(' + ') };
  }
  return { amount: priced.reduce((sum, p) => sum + (p.size ?? 0) * p.cost, 0), currency: 'EUR' };
}

/** The catalogue product a building's technology came from, else its type's default product. */
export function productOf(catalogue: Technology[], techKey: string, tech: BuildingTech): Technology | undefined {
  return catalogue.find((p) => p.key === (tech.product ?? techKey)) ?? defaultProduct(catalogue, techKey);
}

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The fields of a technology: the headline ones FIELDS names first, then every
 * other parameter the building stores, with the catalogue product's unit and limits.
 */
function specsOf(techKey: string, tech: BuildingTech, product: Technology | undefined): FieldSpec[] {
  const named = FIELDS[techKey] ?? DEFAULT_FIELDS;
  const others = (tech.constraints ?? [])
    .filter((c) => !named.some((spec) => spec.key === c.key))
    .map((c): FieldSpec => {
      const meta = product?.constraints.find((m) => m.key === c.key);
      return { key: c.key, unit: meta?.unit ?? '', unbounded: meta?.default_value === UNBOUNDED, min: finite(meta?.min), max: finite(meta?.max) };
    });
  return [...named, ...others];
}

/** A field's label: its headline name, else the parameter's translated name. */
function labelOf(spec: FieldSpec, runMode: 'plan' | 'operate', product: Technology | undefined, t: Translate): string {
  if (!spec.label) {
    const alias = product?.constraints.find((m) => m.key === spec.key)?.alias;
    return t(`parameters.names.${spec.key}`, { defaultValue: alias ?? spec.key });
  }
  return t(`buildingConfig.tech.${spec.unbounded && runMode === 'plan' ? `${spec.label}Max` : spec.label}`);
}

/** Edits are refused per field; the message is shown under it until a valid value arrives. */
export type FieldErrors = Record<string, string>;

/** Key of one field's error in FieldErrors. */
export const errorKey = (techKey: string, fieldKey: string) => `${techKey}:${fieldKey}`;

/**
 * One card per installed technology except PV, whose card the configurator
 * draws from its pv prop. catalogue labels the parameters and lists the
 * products a card offers; without it the cards show the headline fields' names.
 */
export function technologyCards(
  techs: BuildingTechs,
  runMode: 'plan' | 'operate',
  errors: FieldErrors,
  t: Translate,
  catalogue: Technology[] = [],
): Omit<TechCard, 'action'>[] {
  return Object.entries(techs).filter(([techKey]) => techKey !== 'pv_supply').map(([techKey, tech]) => {
    const product = productOf(catalogue, techKey, tech);
    const fields: TechField[] = [];
    const figures: NonNullable<TechCard['figures']> = [];
    for (const spec of specsOf(techKey, tech, product)) {
      const value = cardValue(tech.constraints?.find((c) => c.key === spec.key)?.value);
      if (value === undefined) continue;
      const label = labelOf(spec, runMode, product, t);
      // The investment has its own line on the card, worked out from these figures.
      if (spec.label && spec.label !== 'investment') figures.push({ label, value, unit: spec.unit || undefined });
      fields.push({
        key: spec.key,
        label,
        value,
        unit: spec.unit || undefined,
        editable: true,
        min: spec.min ?? 0,
        max: spec.max,
        error: errors[errorKey(techKey, spec.key)],
      });
    }
    const title = t(`technologies.types.${techKey}`, { defaultValue: tech.alias ?? techKey });
    // The default product's name only repeats the title.
    const subtitle = tech.product && tech.product !== techKey ? tech.alias : undefined;
    return { id: techKey, type: techKey, title, subtitle, fields, figures, investment: investmentOf(tech) };
  });
}

/** The products a card offers, as the configurator's drop-down lists them; empty when there is no choice. */
export function productOptions(catalogue: Technology[], techKey: string): { id: string; name: string; detail?: string }[] {
  const products = productsOfType(catalogue, techKey);
  if (products.length < 2) return [];
  return products.map((p) => ({
    id: p.key,
    name: p.alias,
    detail: p.manufacturer ?? undefined,
  }));
}

/** The techs with techKey switched to product, at the product's own values. */
export function setTechProduct(techs: BuildingTechs, techKey: string, product: Technology): BuildingTechs {
  const tech = techs[techKey];
  if (!tech) return techs;
  return {
    ...techs,
    [techKey]: { ...tech, alias: product.alias, icon: product.icon, product: product.key, constraints: defaultConstraints(product) },
  };
}


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
  catalogue: Technology[] = [],
): { techs: BuildingTechs } | { error: string } {
  const tech = techs[techKey];
  const spec = tech && specsOf(techKey, tech, productOf(catalogue, techKey, tech)).find((f) => f.key === fieldKey);
  if (!tech || !spec) return { error: t('buildingConfig.tech.notEditable') };
  const refused = refusal(spec, value, t);
  if (refused) return { error: refused };
  const stored = value === null ? UNBOUNDED : value;
  const constraints = (tech.constraints ?? []).map((c) => (c.key === fieldKey ? { ...c, value: stored } : c));
  return { techs: { ...techs, [techKey]: { ...tech, constraints } } };
}

/** Why value does not fit spec, or null when it does. */
function refusal(spec: FieldSpec, value: number | null, t: Translate): string | null {
  if (value === null) return spec.unbounded ? null : t('buildingConfig.tech.required');
  if (spec.positive && value <= 0) return t('buildingConfig.tech.positive');
  if (value < (spec.min ?? 0)) return spec.min ? t('buildingConfig.tech.atLeast', { min: spec.min }) : t('buildingConfig.tech.notNegative');
  if (spec.max !== undefined && value > spec.max) return t('buildingConfig.tech.atMost', { max: spec.max });
  return null;
}

/** The techs without techKey. */
export function removeTech(techs: BuildingTechs, techKey: string): BuildingTechs {
  const next = { ...techs };
  delete next[techKey];
  return next;
}


/** The view's Technologies prop; undefined hides the tab, so it is kept while technologies can be added. */
export function technologiesProp(
  items: TechCard[],
  onChange: Technologies['onChange'],
  onRemove: Technologies['onRemove'],
  onAdd?: () => void,
): Technologies | undefined {
  if (items.length === 0 && !onAdd) return undefined;
  return { items, onChange, onRemove, onAdd };
}
