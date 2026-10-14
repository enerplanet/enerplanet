// Pure bottleneck analysis for grid line results.
//
// A "bottleneck" is a wire whose peak loading is at or above the rating
// threshold. The financial figure is grounded in the wire's ACTUAL measured
// losses (summed per timestep) valued at the model's energy price; the upgrade
// figure is an ESTIMATE — it assumes line loss scales as the square of loading
// and that re-sizing to run at a target loading (50%) cuts losses accordingly.
// No cable investment cost is modelled (deliberately; it is outside our scope).

// A wire is unambiguous when loading is undefined (no resolvable rating-implied
// percentage). It can still be ranked by apparent power.
export interface LineLoadingRow {
  line: string;
  bus0?: string;
  bus1?: string;
  p0: number;
  p1?: number;
  loading_percent?: number;
}

export interface BottleneckItem {
  line: string;
  bus0?: string;
  bus1?: string;
  peakLoadingPercent: number | null; // null when no rating-derived % exists
  peakApparentKva: number;
  annualLossKwh: number;
  annualLossCostEur: number;
  status: 'overload' | 'near';
  // Sizing recommendation: the cable should be re-rated so the same flow runs
  // at the target loading, i.e. a multiplier on its current rating.
  recommendedRatingMultiplier: number;
  // Upgrade loss estimate: current annual loss scaled by (targetLoading/peak)^2.
  estimatedUpgradeLossKwh: number;
  estimatedUpgradeLossCostEur: number;
  estimatedSavingEurPerPeriod: number;
}

export const LOADING_TARGET_PERCENT = 50; // run re-sized cable at 50% of rating
export const LOADING_NEAR_PERCENT = 80; // amber band begins here
export const LOADING_OVERLOAD_PERCENT = 100; // red

// Peak apparent power of a wire, in kVA, from its two end-point readings.
export function apparentPowerKva(p0: number, p1?: number): number {
  const a = Math.abs(p0);
  const b = p1 === undefined ? 0 : Math.abs(p1);
  return Math.max(a, b);
}

// Per-timestep conductor loss in kW (|P_out| - |P_in| on the same conductor).
export function wireLossKw(p0: number, p1?: number): number {
  if (p1 === undefined || !Number.isFinite(p1)) return 0;
  if (!Number.isFinite(p0)) return 0;
  return Math.abs(Math.abs(p0) - Math.abs(p1));
}

export function annualLossKwh(rows: LineLoadingRow[]): number {
  return rows.reduce((sum, r) => sum + wireLossKw(r.p0, r.p1), 0);
}

// Compute the bottleneck list from per-wire rows (+ optional ratings map that
// supplies peakLoadingPercent when the rows only carry flow + ratings are fair,
// e.g. legacy/meme utilisation path). rows are grouped per line before calling.
export function analyzeBottleneck(
  line: string,
  rows: LineLoadingRow[],
  peakLoadingPercent: number | null,
  lcoeEurPerKwh: number,
  hoursPerTimestep: number,
): BottleneckItem {
  const peakApparentKva = rows.reduce((max, r) => Math.max(max, apparentPowerKva(r.p0, r.p1)), 0);
  const yearLossKwh = annualLossKwh(rows) * hoursPerTimestep;

  const pct = peakLoadingPercent;
  const status: BottleneckItem['status'] =
    pct !== null && pct > LOADING_OVERLOAD_PERCENT ? 'overload' : 'near';

  // Re-rating recommendation: to have the same flow sit at the target loading,
  // the rating must be (peakLoading/target)-fold larger. Unknown pct => no rule.
  const recommendedRatingMultiplier =
    pct !== null && pct > 0 ? Math.max(1, pct / LOADING_TARGET_PERCENT) : null;

  // Upgrade estimate: loss ∝ loading², so re-rating so the flow runs at the
  // target loading scales losses by (target/peak)².
  const scaledPct = pct !== null && pct > 0 ? pct : null;
  const upgradeFactor = scaledPct ? Math.pow(LOADING_TARGET_PERCENT / scaledPct, 2) : null;
  const estimatedUpgradeLossKwh = upgradeFactor !== null
    ? Math.min(yearLossKwh, yearLossKwh * upgradeFactor)
    : yearLossKwh;

  const annualLossCostEur = yearLossKwh * lcoeEurPerKwh;
  const estimatedUpgradeLossCostEur = estimatedUpgradeLossKwh * lcoeEurPerKwh;

  return {
    line,
    bus0: rows.find(r => r.bus0)?.bus0,
    bus1: rows.find(r => r.bus1)?.bus1,
    peakLoadingPercent: pct,
    peakApparentKva,
    annualLossKwh: yearLossKwh,
    annualLossCostEur,
    status,
    recommendedRatingMultiplier: recommendedRatingMultiplier || 1,
    estimatedUpgradeLossKwh,
    estimatedUpgradeLossCostEur,
    estimatedSavingEurPerPeriod: Math.max(0, annualLossCostEur - estimatedUpgradeLossCostEur),
  };
}

// Group raw line_loading rows per wire and analyze each against the threshold.
// Only wires at/above the near threshold (plus any wire without a loading % but
// with nonzero flow) are returned, sorted by loading desc.
export function computeBottlenecks(
  rows: LineLoadingRow[],
  ratings: Record<string, number>,
  lcoeEurPerKwh: number,
  hoursPerTimestep: number,
): BottleneckItem[] {
  const byLine = new Map<string, LineLoadingRow[]>();
  rows.forEach(r => {
    if (!byLine.has(r.line)) byLine.set(r.line, []);
    byLine.get(r.line)!.push(r);
  });

  const items: BottleneckItem[] = [];
  byLine.forEach((lineRows, line) => {
    // Prefer the declared loading_percent; else derive from apparent/rating.
    let pct: number | null = null;
    lineRows.forEach(r => {
      if (r.loading_percent !== undefined && r.loading_percent !== null) {
        pct = Math.max(pct ?? 0, r.loading_percent);
      }
    });
    if (pct === null) {
      const rating = ratings[line];
      const peak = lineRows.reduce((m, r) => Math.max(m, apparentPowerKva(r.p0, r.p1)), 0);
      if (rating && rating > 0) pct = (peak / rating) * 100;
    }

    // Only report wires that are at/above the amber rating threshold. A wire
    // without a resolvable rating% is not a bottleneck (no rating => cannot
    // judge load vs capacity) and must not surface as a noise row.
    if (pct === null || pct < LOADING_NEAR_PERCENT) return;
    items.push(analyzeBottleneck(line, lineRows, pct, lcoeEurPerKwh, hoursPerTimestep));
  });

  return items.sort((a, b) =>
    (b.peakLoadingPercent ?? -1) - (a.peakLoadingPercent ?? -1)
    || b.peakApparentKva - a.peakApparentKva
  );
}