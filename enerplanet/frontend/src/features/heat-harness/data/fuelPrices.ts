// ---------------------------------------------------------------------------
// External carrier default prices (plan §1a) — EUR per MWh, estimates.
// Everything except heat/electricity is an external purchase.
// Instance fuel_cost_per_mwh (when populated) overrides these.
// TEMPORARY harness data — flagged for domain review.
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
  // primary resources / by-products — no purchase cost, flows via techs
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

/** Price for a carrier input; unknown carriers default to 0 (no data). */
export function carrierPrice(carrier: string): number {
  return DEFAULT_CARRIER_PRICE_EUR_MWH[carrier.toLowerCase()] ?? 0;
}