/**
 * Levelised cost of energy (LCOE) unit handling for the results UI.
 *
 * The results store holds the MEME/Calliope levelised cost **unscaled** — the
 * ingest explicitly does not rescale ratios, money or levelised costs — and the
 * stored number is **EUR per MWh**, not per kWh. Verified against a real run:
 * `results_cost.csv` totals 966.96 € over 3.2232 MWh of demand = 300.00
 * EUR/MWh, with the model's import tariff at 300 EUR/MWh. So the stored
 * `300` means 0.30 €/kWh = 30 ct/kWh.
 *
 * Treating that number as €/kWh and multiplying by 100 (the old behaviour)
 * displays 30 000 ct/kWh — a factor-1000 error. Every display site must go
 * through these helpers instead of hardcoding a conversion.
 */
export const LCOE_STORED_UNIT = 'EUR/MWh';

/** 300 EUR/MWh → 30 ct/kWh. */
export function lcoeToCtkwh(eurPerMwh: number | null | undefined): number {
  if (eurPerMwh == null || !Number.isFinite(eurPerMwh)) return 0;
  return eurPerMwh / 10;
}

/** 300 EUR/MWh → 0.3 EUR/kWh. */
export function lcoeToEurPerKwh(eurPerMwh: number | null | undefined): number {
  if (eurPerMwh == null || !Number.isFinite(eurPerMwh)) return 0;
  return eurPerMwh / 1000;
}

/** "30.0 ct/kWh" from a stored EUR/MWh value. */
export function formatLcoeCtkwh(eurPerMwh: number | null | undefined, digits = 2): string {
  return `${lcoeToCtkwh(eurPerMwh).toFixed(digits)} ct/kWh`;
}

/** "0.300 €/kWh" from a stored EUR/MWh value. */
export function formatLcoeEurPerKwh(eurPerMwh: number | null | undefined, digits = 3): string {
  return `€${lcoeToEurPerKwh(eurPerMwh).toFixed(digits)}/kWh`;
}

/**
 * Energy served by a technology, in kWh, from its monetary cost and its
 * levelised cost: cost € ÷ (EUR/MWh) = MWh, then ×1000 for kWh.
 */
export function energyKwhFromCost(totalCostEur: number, eurPerMwh: number | null | undefined): number {
  const lcoe = eurPerMwh ?? 0;
  if (!Number.isFinite(totalCostEur) || lcoe <= 0) return 0;
  return (totalCostEur / lcoe) * 1000;
}
