// ---------------------------------------------------------------------------
// Heat Harness — minimal functional slice of the heat-network plan.
// Route: /app/heat-harness (auth-protected, see App.tsx).
//
// Covers: expected-fit auto-resolve (§1/§3), OpenTech-DB catalog (§5a),
// light heat links (producer→consumer, §2), blocking check (§4), fuel
// defaults (§1a). NOT the final configurator — temporary harness, hardcoded
// English labels, legacy configurator untouched.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Flame, AlertTriangle, CheckCircle2, Zap, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  HarnessBuilding,
  HarnessPayload,
  HeatResolutionMode,
  OtdbHeatTech,
} from './types';
import { COMMON_F_CLASSES, estimateHeatDemand, isZeroDemandClass } from './data/heatDemand';
import { SIMPLE_DEFAULT_TECH, expectedFitTech, expectedFitSlugs } from './data/expectedFit';
import { carrierPrice } from './data/fuelPrices';
import { fetchHeatTechs, fetchTechDefaultInstance } from './services/opentechdb';

const SEED_BUILDINGS: HarnessBuilding[] = [
  { id: 'b1', label: 'Apartment complex', fClass: 'apartments', areaSqm: 2000, techSlug: '', supplierId: '', estimated: false },
  { id: 'b2', label: 'Single-family house', fClass: 'sfh', areaSqm: 150, techSlug: '', supplierId: '', estimated: false },
  { id: 'b3', label: 'Industrial complex', fClass: 'industrial', areaSqm: 5000, techSlug: '', supplierId: '', estimated: false },
  { id: 'b4', label: 'Shed (zero demand)', fClass: 'shed', areaSqm: 200, techSlug: '', supplierId: '', estimated: false },
];

const fmtNum = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} GWh` : `${Math.round(n).toLocaleString()} kWh`;

export const HeatHarnessPage = () => {
  const [mode, setMode] = useState<HeatResolutionMode>('expected');
  const [buildings, setBuildings] = useState<HarnessBuilding[]>(SEED_BUILDINGS);
  const [catalog, setCatalog] = useState<OtdbHeatTech[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSource, setCatalogSource] = useState<'opentechdb' | 'fallback'>('opentechdb');
  const [runPayload, setRunPayload] = useState<HarnessPayload | null>(null);

  // Load catalog once; warm instances for the slugs the tables reference.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        let techs = await fetchHeatTechs();
        if (cancelled) return;
        const usedSlugs = new Set([SIMPLE_DEFAULT_TECH, ...expectedFitSlugs()]);
        techs = await Promise.all(techs.map(async (t) =>
          usedSlugs.has(t.slug) ? fetchTechDefaultInstance(t) : t
        ));
        if (cancelled) return;
        setCatalog(techs);
        setCatalogSource(techs.some((t) => t.id.startsWith('local-')) ? 'fallback' : 'opentechdb');
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ----- auto-resolve ------------------------------------------------------

  const autoTechFor = (b: HarnessBuilding): string => {
    if (isZeroDemandClass(b.fClass)) return '';
    if (mode === 'simple') return SIMPLE_DEFAULT_TECH;
    if (mode === 'expected') return expectedFitTech(b.fClass);
    return ''; // manual: user decides
  };

  /** Re-resolve ALL buildings for the current mode (estimated badges on). */
  const applyAutoResolve = (nextMode: HeatResolutionMode): void => {
    setMode(nextMode);
    if (nextMode === 'manual') return; // leave as-is; user picks manually
    setBuildings((prev) =>
      prev.map((b) => {
        const tech = autoTechFor(b);
        return { ...b, techSlug: tech, estimated: tech !== '' };
      })
    );
  };

  // ----- derived view ------------------------------------------------------

  const views = useMemo(() =>
    buildings.map((b) => {
      const demandKwh = estimateHeatDemand(b.fClass, b.areaSqm, b.explicitDemandKwh);
      const hasOwnTech = b.techSlug !== '';
      const isProducer = hasOwnTech;
      const suppliedById = b.supplierId || null;
      const resolved = demandKwh === 0 || hasOwnTech || Boolean(
        suppliedById && buildings.find((p) => p.id === suppliedById)?.techSlug
      );
      return { ...b, demandKwh, hasOwnTech, isProducer, suppliedById, resolved };
    }), [buildings]);

  const producers = views.filter((v) => v.isProducer);
  const unresolved = views.filter((v) => !v.resolved && v.demandKwh > 0);
  const totalDemandKwh = views.reduce((s, v) => s + v.demandKwh, 0);

  const techById = useMemo(() => {
    const m = new Map<string, OtdbHeatTech>();
    catalog.forEach((t) => m.set(t.slug, t));
    return m;
  }, [catalog]);

  // ----- actions -----------------------------------------------------------

  const addBuilding = (): void => {
    const maxN = buildings.reduce((m, b) => {
      const n = Number(b.id.replace(/\D/g, ''));
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    const n = maxN + 1;
    setBuildings((prev) => [...prev, {
      id: `b${n}`, label: `Building ${n}`, fClass: 'office', areaSqm: 400,
      techSlug: '', supplierId: '', estimated: false,
    }]);
  };

  const removeBuilding = (id: string): void => {
    setBuildings((prev) =>
      prev.filter((b) => b.id !== id)
         .map((b) => (b.supplierId === id ? { ...b, supplierId: '' } : b))
    );
  };

  const patchBuilding = (id: string, patch: Partial<HarnessBuilding>): void => {
    setBuildings((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next = { ...b, ...patch };
        // manual tech pick clears the estimated badge
        if (patch.techSlug !== undefined) next.estimated = false;
        // can't be your own supplier
        if (patch.supplierId === id) next.supplierId = '';
        return next;
      })
    );
  };

  const run = (): void => {
    setRunPayload({
      energyVectors: ['electricity', 'heat'],
      heatResolutionMode: mode,
      buildings: views.map((v) => ({
        id: v.id,
        fClass: v.fClass,
        area_sqm: v.areaSqm,
        demand_heat_kwh: v.demandKwh,
        tech: v.techSlug || null,
        estimated: v.estimated,
      })),
      heatLinks: views
        .filter((v) => v.suppliedById)
        .map((v) => ({ from: v.suppliedById!, to: v.id })),
    });
  };

  // ----- render ------------------------------------------------------------

  return (
    <div className="md-scope min-h-full bg-background">
      <div className="mx-auto max-w-5xl p-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" />
              Heat Resolution Harness
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Minimal functional slice of the heat-network plan. Auto-resolve heat supply per
              building type, link producers to consumers, and block until the network resolves.
            </p>
          </div>
          {catalogLoading ? (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> loading OpenTech-DB…
            </span>
          ) : (
            <span className={`text-xs px-2 py-1 rounded-full border ${catalogSource === 'opentechdb' ? 'text-green-600 border-green-300' : 'text-amber-600 border-amber-300'}`}>
              {catalogSource === 'opentechdb' ? 'OpenTech-DB live' : 'fallback catalog'}
            </span>
          )}
        </header>

        {/* Mode selector (§3) */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground mb-2">Auto-resolve mode</h2>
          <div className="flex gap-2">
            {([
              ['simple', 'Simple default', 'electric_boilers for everything'],
              ['expected', 'Expected fit', 'per building type (ASHP, gas boiler, CHP…)'],
              ['manual', 'Manual', 'no auto-assign; you pick'],
            ] as [HeatResolutionMode, string, string][]).map(([m, label, desc]) => (
              <button
                key={m}
                onClick={() => applyAutoResolve(m)}
                className={`flex-1 rounded-lg border px-3 py-2 text-left transition-colors ${
                  mode === m
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50'
                }`}
              >
                <div className="text-sm font-medium">{label}</div>
                <div className="text-[11px] mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Buildings (§1/§2/§5) */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Buildings <span className="text-muted-foreground font-normal">({buildings.length})</span>
            </h2>
            <button onClick={addBuilding} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border hover:bg-muted/50 text-foreground">
              <Plus className="h-3 w-3" /> Add building
            </button>
          </div>

          {views.map((v) => {
            const tech = techById.get(v.techSlug);
            return (
              <div key={v.id} className={`rounded-lg border p-3 space-y-2 ${v.demandKwh === 0 ? 'border-border/50 bg-muted/20' : 'border-border'} ${!v.resolved ? 'ring-1 ring-red-300 dark:ring-red-900/50' : ''}`}>
                <div className="flex items-center gap-2">
                  {v.demandKwh > 0 ?
                    <span className={`w-2 h-2 rounded-full ${v.resolved ? 'bg-green-500' : 'bg-red-500'}`} /> :
                    <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600" />}
                  <input
                    value={v.label}
                    onChange={(e) => patchBuilding(v.id, { label: e.target.value })}
                    className="text-sm font-medium bg-transparent text-foreground border-b border-transparent focus:border-border outline-none"
                  />
                  <span className="text-xs text-muted-foreground">
                    {fmtNum(v.demandKwh)}{v.explicitDemandKwh ? ' (explicit)' : ' · estimated'}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">{v.demandKwh === 0 && '· zero demand'}</span>
                    <button onClick={() => removeBuilding(v.id)} className="p-1 text-muted-foreground hover:text-red-500 rounded"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <label className="text-xs flex flex-col gap-1">
                    <span className="text-muted-foreground">Type</span>
                    <select
                      value={v.fClass}
                      onChange={(e) => patchBuilding(v.id, { fClass: e.target.value, techSlug: '', supplierId: '' })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    >
                      {COMMON_F_CLASSES.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs flex flex-col gap-1">
                    <span className="text-muted-foreground">Area (m²)</span>
                    <input
                      type="number" min={0} value={v.areaSqm}
                      onChange={(e) => patchBuilding(v.id, { areaSqm: Math.max(0, Number(e.target.value)) })}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                  </label>
                  <label className="text-xs flex flex-col gap-1">
                    <span className="text-muted-foreground">Heat tech <span className="text-amber-500">*</span></span>
                    <div className="flex items-center gap-1">
                      <select
                        value={v.techSlug}
                        onChange={(e) => patchBuilding(v.id, { techSlug: e.target.value })}
                        disabled={catalogLoading}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                      >
                        <option value="">— none —</option>
                        {catalog.map((t) => (
                          <option key={t.slug} value={t.slug}>{t.name}</option>
                        ))}
                      </select>
                      {v.estimated && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                          estimated
                        </span>
                      )}
                    </div>
                  </label>
                  <label className="text-xs flex flex-col gap-1">
                    <span className="text-muted-foreground">Supply from (optional)</span>
                    <select
                      value={v.supplierId}
                      onChange={(e) => patchBuilding(v.id, { supplierId: e.target.value })}
                      disabled={producers.length === 0}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    >
                      <option value="">— none —</option>
                      {producers.filter((p) => p.id !== v.id).map((p) => (
                        <option key={p.id} value={p.id}>{p.label} ({p.techSlug})</option>
                      ))}
                    </select>
                  </label>
                </div>

                {tech?.instance && (
                  <p className="text-[11px] text-muted-foreground">
                    <span className="font-medium">{tech.instance.label}</span>
                    {tech.instance.capacity_kw ? ` · ${Math.round(tech.instance.capacity_kw).toLocaleString()} kW` : ''}
                    {tech.instance.capex_per_kw ? ` · ${tech.instance.capex_per_kw} USD/kW` : ''}
                    {tech.input_carriers[0] ? ` · ${tech.input_carriers[0]} @ ${carrierPrice(tech.input_carriers[0])} €/MWh` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Blocking check (§4) + run */}
        <div className={`rounded-xl border p-4 ${unresolved.length > 0 ? 'border-red-300 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20' : 'border-green-300 dark:border-green-900/60 bg-green-50/40 dark:bg-green-950/20'}`}>
          {unresolved.length > 0 ? (
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">Heat network cannot resolve demand</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {unresolved.map((b) => <span key={b.id}>{b.label} ({fmtNum(b.demandKwh)}), </span>)}
                  have demand but no heat tech and no connected producer. Assign a tech, add a supplier,
                  or switch resolution mode.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="text-sm font-medium text-foreground">
                  All heat demand resolved ({fmtNum(totalDemandKwh)})
                </span>
              </div>
              <button
                onClick={run}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
              >
                <Zap className="h-4 w-4" /> Run (preview payload)
              </button>
            </div>
          )}
        </div>

        {/* Payload preview */}
        {runPayload && (
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Payload preview</h3>
            <pre className="text-[11px] bg-muted/50 rounded-lg p-3 overflow-x-auto text-muted-foreground">
              {JSON.stringify(runPayload, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};



export default HeatHarnessPage;