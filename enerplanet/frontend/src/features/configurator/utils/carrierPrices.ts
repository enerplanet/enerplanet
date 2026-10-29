// ---------------------------------------------------------------------------
// External carrier default prices - EUR per MWh (estimates, configurator-local).
// Port of the harness `fuelPrices.ts` into the production configurator flow.

// Everything except heat/electricity is an external purchase; those two are
// generated inside the model and need no carrier-level default. Instance
// `fuel_cost_per_mwh` (when populated by OpenTech-DB) overrides these; this
// table only fills the gap for external fuel purchases.

// ---------------------------------------------------------------------------

export const DEFAULT_CARRIER_PRICE_EUR_MWH: Record<string, number> = {
  natural_gas: 35,
  biomass: 28,
  biogas: 70,
  syngas: 30,
  methane: 30,
  oil: 65,
  liquid_fuel: 60,
  coal: 12,
  hydrogen: 120,
  ammonia: 180,
  nuclear_fuel: 5,
  flue_gas: 0,
  co2: 0,
  nitrogen: 0,
  water: 0,
  wind: 0,
  solar_irradiance: 0,
  geothermal_energy: 0,
  cooling: 0,
  steam: 0,
};

/** Carriers the app generates internally - never priced at the carrier level.**/
export const INTERNALLY_GENERATED_CARRIERS = new Set(["heat", "electricity"]);

export const isGridGeneratedCarrier = (carrier: string): boolean =>
  INTERNALLY_GENERATED_CARRIERS.has(carrier.toLowerCase());

/** Price for a carrier input (EUR/MWh); unknown or internally-generated carriers default to 0.**/
export function carrierPrice(carrier: string): number {
  if (isGridGeneratedCarrier(carrier)) return 0;
  return DEFAULT_CARRIER_PRICE_EUR_MWH[carrier.toLowerCase()] ?? 0;
}

/**
 * The priced (externally-bought) fuel input carrier for a tech, or undefined when
 * none - e.g. purely electricity/heat techs (generated internally) or carriers
 * with no default.
 */
export function pricedFuelCarrier(inputCarriers: string[] | undefined): string | undefined {
  return (inputCarriers ?? []).find((c) => carrierPrice(c) > 0);
}
