// ---------------------------------------------------------------------------
// Minimal OpenTech-DB client (via the backend proxy at /api/opentech-db).
// Raw passthrough — no {success,data} envelope. Falls back to a hardcoded
// catalog when the proxy is unreachable so the harness works offline.
// TEMPORARY harness code; replaced by the real tech-service integration.
// ---------------------------------------------------------------------------

import api from '@/lib/axios';
import { OtdbHeatTech } from '../types';

interface OtdbTechListItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  input_carriers: string[];
  output_carriers: string[];
  n_instances?: number;
}

interface OtdbTechDetail {
  id: string;
  name: string;
  instances?: Array<{
    id: string;
    label: string;
    capacity_kw?: { value?: number; unit?: string };
    capex_per_kw?: { value?: number; unit?: string };
    electrical_efficiency?: { value?: number };
    fuel_cost_per_mwh?: { value?: number; unit?: string };
  }>;
}

/** Hardcoded fallback catalog (same slugs/names as the live OpenTech-DB). */
const FALLBACK_CATALOG: OtdbHeatTech[] = [
  { id: 'local-air-source-heat-pump', slug: 'air_source_heat_pump', name: 'Air-Source Heat Pump', category: 'conversion', input_carriers: ['electricity'], output_carriers: ['heat'], instance: { label: 'Local fallback instance', efficiency: 0.35 } },
  { id: 'local-ground-source-heat-pump', slug: 'ground_source_heat_pump', name: 'Ground-Source Heat Pump', category: 'conversion', input_carriers: ['electricity'], output_carriers: ['heat'], instance: { label: 'Local fallback instance', efficiency: 0.45 } },
  { id: 'local-electric-boilers', slug: 'electric_boilers', name: 'Electric Boilers', category: 'conversion', input_carriers: ['electricity'], output_carriers: ['heat'], instance: { label: 'Local fallback instance', efficiency: 0.98 } },
  { id: 'local-gas-boiler', slug: 'gas_boiler', name: 'Gas Boiler', category: 'conversion', input_carriers: ['natural_gas'], output_carriers: ['heat'], instance: { label: 'Local fallback instance', efficiency: 0.9 } },
  { id: 'local-chp-gas', slug: 'chp_gas', name: 'Combined Heat and Power (CHP)', category: 'conversion', input_carriers: ['natural_gas'], output_carriers: ['electricity', 'heat'], instance: { label: 'Local fallback instance', efficiency: 0.85 } },
  { id: 'local-biomass-chp', slug: 'biomass_chp', name: 'Biomass CHP', category: 'conversion', input_carriers: ['biomass'], output_carriers: ['electricity', 'heat'], instance: { label: 'Local fallback instance', efficiency: 0.8 } },
  { id: 'local-sensible-thermal-storage', slug: 'sensible_thermal_storage', name: 'Sensible Thermal Storage', category: 'storage', input_carriers: ['heat'], output_carriers: ['heat'], instance: { label: 'Local fallback instance' } },
];

let catalogCache: OtdbHeatTech[] | null = null;

/** Fetch all heat-output technologies from the proxy; fallback on failure. */
export async function fetchHeatTechs(): Promise<OtdbHeatTech[]> {
  if (catalogCache) return catalogCache;

  try {
    const resp = await api.get<{ total: number; technologies: OtdbTechListItem[] }>(
      '/opentech-db/technologies?limit=100'
    );
    const techs = resp.data?.technologies ?? [];

    const heatTechs: OtdbHeatTech[] = techs
      .filter((t) => (t.output_carriers ?? []).some((c) => c === 'heat'))
      .map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        category: t.category,
        input_carriers: t.input_carriers ?? [],
        output_carriers: t.output_carriers ?? [],
      }));

    if (heatTechs.length > 0) {
      catalogCache = heatTechs;
      return heatTechs;
    }
  } catch (err) {
    // proxy unreachable — fall through to the local fallback catalog
    console.warn('[heat-harness] OpenTech-DB proxy fetch failed, using fallback catalog:', err);
  }

  catalogCache = FALLBACK_CATALOG;
  return catalogCache;
}

/** Load the default instance (instances[0]) for one tech; no-op on failure. */
export async function fetchTechDefaultInstance(tech: OtdbHeatTech): Promise<OtdbHeatTech> {
  if (tech.instance || tech.id.startsWith('local-')) return tech;

  try {
    const resp = await api.get<OtdbTechDetail>(`/opentech-db/technologies/${tech.id}`);
    const inst = resp.data?.instances?.[0];
    if (inst) {
      return {
        ...tech,
        instance: {
          label: inst.label,
          capacity_kw: inst.capacity_kw?.value,
          capex_per_kw: inst.capex_per_kw?.value,
          efficiency: inst.electrical_efficiency?.value,
          fuel_cost_per_mwh: inst.fuel_cost_per_mwh?.value,
        },
      };
    }
  } catch (err) {
    console.warn(`[heat-harness] failed to load instance for ${tech.slug}:`, err);
  }
  return tech;
}