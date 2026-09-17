// Manager panel for PV systems distributed across multiple surfaces.
// Summarises installed PV surfaces and recommends un-configured surfaces
// suitable for PV installation, scored by orientation, tilt, and area.

import { ChevronRight, Sun, Sparkles } from 'lucide-react';

import { ScrollHintContainer } from '@/features/configurator/building-config/panel/shared/ui';
import type { PvConfig } from '@/features/configurator/building-config/panel/shared/buildingDefaults';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PvSurfaceEntry {
  element: BuildingElement;
  pv: PvConfig;
}

interface PvSurfaceManagerProps {
  surfaces: PvSurfaceEntry[];
  totalCapacityKw: number;
  mode: 'basic' | 'expert';
  onEditSurface: (surfaceId: string) => void;
  /** All building elements — used to compute surface recommendations. */
  allElements: Record<string, BuildingElement>;
  /** Called when the user clicks "Enable PV" on a recommendation card. */
  onEnableSurface: (surfaceId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function compassDir(azimuth: number): string {
  // city2tabula sets azimuth to -1 for surfaces too close to horizontal for a
  // bearing to mean anything (see isFlatRoof below) — reading it as a compass
  // value would silently show "N", a plausible-looking wrong answer.
  if (azimuth === -1) return 'flat';
  const dirs: Array<[number, string]> = [
    [22.5, 'N'], [67.5, 'NE'], [112.5, 'E'], [157.5, 'SE'],
    [202.5, 'S'], [247.5, 'SW'], [292.5, 'W'], [337.5, 'NW'],
  ];
  return dirs.find(([limit]) => azimuth < limit)?.[1] ?? 'N';
}

/** city2tabula's own signal for "this surface is horizontal, no meaningful
 * azimuth" (tilt > ~80°, where atan2 stops being numerically stable) — not a
 * heuristic guess, and stable across the whole dataset. On a flat roof,
 * azimuth and tilt for PV are the installer's choice, not a geometry fact. */
function isFlatRoof(el: BuildingElement): boolean {
  return el.azimuth === -1;
}

function effectiveGeometry(element: BuildingElement, pv: PvConfig) {
  return pv.geometryMode === 'surface'
    ? { tilt: element.tilt, azimuth: element.azimuth }
    : { tilt: pv.tilt, azimuth: pv.azimuth };
}

// ─── Recommendation scoring ───────────────────────────────────────────────────

/**
 * Scores a surface for PV suitability (0–1).
 * Returns null for surfaces that are impractical for PV (floor, window, door).
 *
 * Scoring factors:
 *   - Azimuth (40%): south-facing (180°) = 1.0, north-facing = 0.3
 *   - Tilt     (35%): 35° = 1.0 (central-European optimum); degrades toward 0° and 90°
 *   - Area     (25%): scales up to 40 m²; larger surfaces offer more panel options
 *   - Type bonus:     roof surfaces get a 10% boost over walls (better exposure)
 */
function scorePvSurface(el: BuildingElement): number | null {
  if (['floor', 'window', 'door'].includes(el.type)) return null;

  const flat = isFlatRoof(el);
  // Angle from south (0 = south, 180 = north) — meaningless for a flat roof,
  // so never computed from el.azimuth (-1) in that case.
  const azDiff = flat ? 0 : Math.min(Math.abs(el.azimuth - 180), 360 - Math.abs(el.azimuth - 180));

  // Steeply-tilted surfaces facing more than 90° from south get no solar gain in the
  // northern hemisphere — exclude them entirely from recommendations. Flat
  // roofs have no bearing to measure this against, so they're never excluded here.
  if (!flat && azDiff > 90) return null;

  // Cosine-based azimuth score: 1.0 south, 0 east/west.
  // Flat surfaces are unaffected by azimuth so receive full score.
  const azScore = flat ? 1.0 : Math.max(0, Math.cos((azDiff * Math.PI) / 180));

  const tiltScore = Math.max(0, 1 - Math.abs(el.tilt - 35) / 70);
  const areaScore = Math.min(1, el.area / 40);
  const typeBonus = el.type === 'roof' ? 1.1 : 1.0;

  return Math.min(1, (0.4 * azScore + 0.35 * tiltScore + 0.25 * areaScore) * typeBonus);
}

function suitabilityLabel(score: number): { text: string; color: string; bg: string } {
  if (score >= 0.75) return { text: 'Excellent', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' };
  if (score >= 0.55) return { text: 'Good',      color: 'text-blue-700',    bg: 'bg-blue-50 border-blue-200' };
  return               { text: 'Fair',      color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200' };
}

const MIN_SCORE = 0.3;
const MAX_RECOMMENDATIONS = 4;

// ─── Sub-components ───────────────────────────────────────────────────────────

function RecommendationRow({
  element,
  score,
  onEnable,
}: {
  element: BuildingElement;
  score: number;
  onEnable: () => void;
}) {
  const suit = suitabilityLabel(score);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[11px] font-semibold text-slate-700">{element.label}</p>
          <span className={`rounded border px-1 py-px text-[9px] font-semibold ${suit.bg} ${suit.color}`}>
            {suit.text}
          </span>
        </div>
        <p className="text-[10px] text-slate-400">
          {element.area.toFixed(1)} m² · {element.tilt}° · {compassDir(element.azimuth)}
        </p>
      </div>
      <button
        type="button"
        onClick={onEnable}
        className="shrink-0 rounded border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-100"
      >
        + Enable PV
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Middle-panel manager for PV systems distributed across multiple surfaces.
 * Shows installed PV surfaces and recommends un-configured surfaces suitable for PV.
 */
export function PvSurfaceManager({
  surfaces,
  totalCapacityKw,
  mode,
  onEditSurface,
  allElements,
  onEnableSurface,
}: PvSurfaceManagerProps) {
  // Compute recommendations: score all elements, filter by min score and not already installed
  const installedIds = new Set(surfaces.map((s) => s.element.id));
  const recommendations = Object.values(allElements)
    .flatMap((el) => {
      if (installedIds.has(el.id)) return [];
      const score = scorePvSurface(el);
      if (score === null || score < MIN_SCORE) return [];
      return [{ element: el, score }];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECOMMENDATIONS);

  return (
    <ScrollHintContainer className="flex flex-col p-5">

      {/* Header */}
      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-yellow-50">
          <Sun className="size-5 text-yellow-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-800">PV Surfaces</p>
          <p className="text-[11px] text-muted-foreground">
            {surfaces.length} configured {surfaces.length === 1 ? 'surface' : 'surfaces'} · {totalCapacityKw.toFixed(1)} kWp total
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Installed surfaces</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">{surfaces.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Total capacity</p>
          <p className="mt-1 text-2xl font-bold text-slate-800">
            {totalCapacityKw.toFixed(1)} <span className="text-sm font-semibold text-slate-500">kWp</span>
          </p>
        </div>
      </div>

      {/* Installed surfaces */}
      {surfaces.length > 0 && (
        <div className="mb-4 flex flex-col gap-3">
          {surfaces.map(({ element, pv }) => {
            const geometry = effectiveGeometry(element, pv);
            return (
              <div key={element.id} className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-yellow-50">
                    <Sun className="size-4 text-yellow-500" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{element.label}</p>
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {element.type}
                      </span>
                      {pv.geometryMode === 'manual' && (
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          Custom geometry
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500">
                      <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Capacity</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-700">{pv.system_capacity.toFixed(1)} kWp</p>
                      </div>
                      <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Host area</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-700">{element.area.toFixed(1)} m²</p>
                      </div>
                      <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Orientation</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-700">
                          {geometry.tilt}° · {compassDir(geometry.azimuth)}
                        </p>
                      </div>
                      <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Est. panel area</p>
                        <p className="mt-0.5 text-sm font-bold text-slate-700">{(pv.system_capacity * 6.5).toFixed(1)} m²</p>
                      </div>
                    </div>

                    {mode === 'expert' && (
                      <p className="mt-2 text-[10px] text-slate-400">
                        Losses {Math.round(pv.losses * 100)}% · Inverter {Math.round(pv.inv_eff * 100)}% · Lifetime {pv.cont_lifetime} years
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => onEditSurface(element.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
                  >
                    Edit
                    <ChevronRight className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Recommendations section */}
      {recommendations.length > 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Sparkles className="size-3 text-slate-400" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Suggestions - not yet installed
            </p>
          </div>
          <p className="mb-2.5 text-[10px] leading-snug text-slate-400">
            Ranked by orientation, tilt, and area. Click <strong>+ Enable PV</strong> to start configuring a surface.
          </p>
          <div className="flex flex-col gap-1.5">
            {recommendations.map(({ element, score }) => (
              <RecommendationRow
                key={element.id}
                element={element}
                score={score}
                onEnable={() => onEnableSurface(element.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state — no installed surfaces and no recommendations */}
      {surfaces.length === 0 && recommendations.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-white shadow-sm">
            <Sun className="size-5 text-slate-300" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No suitable surfaces found</p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Add a roof or wall surface, then return here to configure PV.
          </p>
        </div>
      )}
    </ScrollHintContainer>
  );
}
