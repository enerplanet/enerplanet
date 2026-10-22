/**
 * Display metadata for an energy carrier (electricity / heat / gas …).
 *
 * The backend treats the carrier as an opaque bucket label ("power", "heat",
 * possibly others). The UI needs three things per carrier that the data alone
 * does not answer:
 *
 *  - **which unit** the numbers are in (kWh/kW for electrical *and* thermal
 *    energy, m³ for a volumetric fuel carrier),
 *  - **which label** to show (i18n key, with the raw label as fallback), and
 *  - **whether the carrier generates energy** — a generation-duration or
 *    renewable-mix chart is meaningful for electricity, meaningless for a
 *    heat demand served by heat pumps.
 *
 * Keep this table the single source of truth: charts and panels read the unit
 * and label from here instead of hardcoding "kWh" / "Power".
 */

/** How a carrier's raw result numbers are measured. */
export type CarrierUnitKind = 'energy' | 'volume';

export interface CarrierDisplay {
  /** Measurement family of the raw values. */
  kind: CarrierUnitKind;
  /** Unit for a time-integrated quantity (kWh, m³). */
  energyUnit: string;
  /** Unit for an instantaneous rate (kW, m³/h). */
  powerUnit: string;
  /** i18n key for the human label; undefined for an unrecognised carrier. */
  labelKey?: string;
  /** True when supply for this carrier is generation (renewables, etc.). */
  generation: boolean;
}

/** i18n keys for carrier labels. Carriers are opaque, so unknown values fall back to the raw label. */
export const CARRIER_LABELS: Record<string, string> = {
  power: 'results.carrier.electricity',
  electricity: 'results.carrier.electricity',
  heat: 'results.carrier.heat',
  thermal: 'results.carrier.heat',
  gas: 'results.carrier.gas',
  natural_gas: 'results.carrier.gas',
  methane: 'results.carrier.gas',
  oil: 'results.carrier.oil',
  liquid_fuel: 'results.carrier.oil',
};

const ELECTRICITY: CarrierDisplay = {
  kind: 'energy',
  energyUnit: 'kWh',
  powerUnit: 'kW',
  labelKey: 'results.carrier.electricity',
  generation: true,
};

const HEAT: CarrierDisplay = {
  kind: 'energy',
  energyUnit: 'kWh',
  powerUnit: 'kW',
  labelKey: 'results.carrier.heat',
  generation: false,
};

/**
 * Volumetric fuel carriers. Reserved for when the backend delivers a fuel
 * carrier: nothing in the current result contract reports m³, so these entries
 * are inert until such a carrier appears in `carrier_summaries`.
 */
const VOLUMETRIC: CarrierDisplay = {
  kind: 'volume',
  energyUnit: 'm³',
  powerUnit: 'm³/h',
  labelKey: 'results.carrier.gas',
  generation: false,
};

const CARRIER_DISPLAY: Record<string, CarrierDisplay> = {
  power: ELECTRICITY,
  electricity: ELECTRICITY,
  heat: HEAT,
  thermal: HEAT,
  gas: VOLUMETRIC,
  natural_gas: VOLUMETRIC,
  methane: VOLUMETRIC,
  oil: { ...VOLUMETRIC, labelKey: 'results.carrier.oil' },
  liquid_fuel: { ...VOLUMETRIC, labelKey: 'results.carrier.oil' },
};

/** Backend default carrier when no `?carrier=` filter is sent. */
export const DEFAULT_CARRIER = 'power';

/**
 * Canonical form of a carrier label. "electricity" and "power" are the same
 * bucket (MEME emits "electricity", the legacy store normalises to "power"),
 * everything else is compared case-insensitively.
 */
export function normalizeCarrier(carrier?: string | null): string {
  const value = (carrier ?? '').trim().toLowerCase();
  if (!value) return DEFAULT_CARRIER;
  return value === 'electricity' ? DEFAULT_CARRIER : value;
}

/** True when two records/labels name the same carrier bucket. */
export function sameCarrier(a?: string | null, b?: string | null): boolean {
  return normalizeCarrier(a) === normalizeCarrier(b);
}

/**
 * Display metadata for a carrier. Unknown carriers are assumed to be a
 * non-generating energy carrier measured in kWh and are labelled with their
 * raw string (labelKey undefined) — never silently dressed up as electricity.
 */
export function carrierDisplay(carrier?: string | null): CarrierDisplay {
  const key = normalizeCarrier(carrier);
  return (
    CARRIER_DISPLAY[key] ?? {
      kind: 'energy',
      energyUnit: 'kWh',
      powerUnit: 'kW',
      generation: false,
    }
  );
}

/** i18n key for a carrier's label, or undefined if the carrier is unknown. */
export function carrierLabelKey(carrier?: string | null): string | undefined {
  return carrierDisplay(carrier).labelKey;
}

/** True when charts describing generation (renewable mix, generation duration) apply. */
export function isGenerationCarrier(carrier?: string | null): boolean {
  return carrierDisplay(carrier).generation;
}

function normalizeValue(value: number, precision = 3): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(precision));
}

function formatVolume(value: number, unit: string, digits: number): string {
  const formatted = normalizeValue(Math.abs(value) < 1e-9 ? 0 : value, digits);
  return `${formatted.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
}

/** Time-integrated quantity in the carrier's own unit (kWh / MWh / m³). */
export function formatCarrierEnergy(value: number, carrier?: string | null): string {
  const { kind, energyUnit } = carrierDisplay(carrier);
  if (kind === 'volume') return formatVolume(value, energyUnit, 1);

  if (!Number.isFinite(value)) return `0 ${energyUnit}`;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} GWh`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)} MWh`;
  return `${value.toFixed(1)} ${energyUnit}`;
}

/** Instantaneous rate in the carrier's own unit (kW / MW / m³/h). */
export function formatCarrierPower(value: number, carrier?: string | null): string {
  const { kind, powerUnit } = carrierDisplay(carrier);
  if (kind === 'volume') return formatVolume(value, powerUnit, 2);

  if (!Number.isFinite(value)) return `0 ${powerUnit}`;
  const abs = Math.abs(value);
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)} MW`;
  if (abs >= 1) return `${value.toFixed(2)} ${powerUnit}`;
  if (abs >= 0.001) return `${(value * 1_000).toFixed(1)} W`;
  if (abs === 0) return `0.0 ${powerUnit}`;
  return `${(value * 1_000_000).toFixed(1)} mW`;
}

/** Axis label for a rate axis, e.g. "Power (kW)" or "Flow (m³/h)". */
export function carrierPowerAxis(axisLabel: string, carrier?: string | null): string {
  return `${axisLabel} (${carrierDisplay(carrier).powerUnit})`;
}

/** Axis label for an energy axis, e.g. "Energy (kWh)". */
export function carrierEnergyAxis(axisLabel: string, carrier?: string | null): string {
  return `${axisLabel} (${carrierDisplay(carrier).energyUnit})`;
}
