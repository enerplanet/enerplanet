// Left column of the Overview view: annual energy hero + technologies.
// Building parameters and envelope now live in the right column's merged details card.

import { AlertTriangle, Zap, Flame, Snowflake, Gauge, Cpu as CpuIcon, Droplets, CookingPot } from 'lucide-react';
import { cn } from '@spatialhub/ui';
import type { EnergySource, EnergyTotals } from '@/features/configurator/building-config/panel/lib/loadProfile';
import { SourceTag, EnergyComparisonNote, ScrollHintContainer } from '../shared/ui';
import { TechnologiesSection } from './TechnologiesSection';

interface PvSummary {
  installed: boolean;
  surfaceCount: number;
  totalCapacityKw: number;
}

export interface BuildingSnapshotAsideProps {
  energyTotals: EnergyTotals;
  thermalRating: { label: string; color: string; bg: string };
  avgUValue: number;
  mode: 'basic' | 'expert';
  installedTechIds: string[];
  pvSummary: PvSummary;
  onToggleTech?: (id: string, installed: boolean) => void;
  /** Opens the matching technology's editor modal. */
  onOpenTech?: (id: string) => void;
}

const ENERGY_ITEMS = [
  { key: 'heating',     label: 'Heating',     Icon: Flame,     iconBg: 'bg-orange-500/20', iconColor: 'text-orange-400', valueColor: 'text-orange-300' },
  { key: 'electricity', label: 'Electricity', Icon: Zap,       iconBg: 'bg-yellow-500/20', iconColor: 'text-yellow-400', valueColor: 'text-yellow-300' },
  { key: 'hotwater',    label: 'Cooling',     Icon: Snowflake, iconBg: 'bg-blue-500/20',   iconColor: 'text-blue-400',   valueColor: 'text-blue-300'   },
  { key: 'dhw',         label: 'Hot water',   Icon: Droplets,  iconBg: 'bg-sky-500/20',    iconColor: 'text-sky-400',   valueColor: 'text-sky-300'     },
  { key: 'kitchen',     label: 'Kitchen (gas)', Icon: CookingPot, iconBg: 'bg-rose-500/20', iconColor: 'text-rose-400', valueColor: 'text-rose-300'   },
] as const;

/** Left panel of the overview: energy hero numbers + installed technologies. */
export function BuildingSnapshotAside({
  energyTotals,
  thermalRating,
  avgUValue,
  mode,
  installedTechIds,
  pvSummary,
  onToggleTech,
  onOpenTech,
}: BuildingSnapshotAsideProps) {
  return (
    <ScrollHintContainer className="flex flex-col gap-3 border-r border-border/80 bg-slate-100 p-4">
    <aside className="flex flex-col gap-3">

      {/* ── Data quality notice ── */}
      <div className="shrink-0 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] text-amber-700">
            Building parameters are estimated from public records. Open the configurator to review and adjust them.
          </p>
        </div>
      </div>

      {/* ── Energy hero + thermal efficiency ── */}
      <div className="shrink-0 overflow-hidden rounded-xl border border-slate-700/60 shadow-[0_1px_3px_rgba(15,23,42,0.07),0_4px_16px_rgba(15,23,42,0.08)]">
        <div className="bg-slate-800 px-5 py-5">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-300">
            Annual energy demand
          </p>

          {/* Total — heating + cooling + electricity + hot water; kitchen (gas) is a
              separate fuel channel and deliberately not folded in, same as BuEM itself. */}
          <div className="mb-4 flex items-baseline justify-between border-b border-slate-700/60 pb-4">
            <span className="text-sm font-medium text-slate-300">Total demand</span>
            <span>
              <span className={cn('text-3xl font-extrabold leading-none', energyTotals.total === '—' ? 'text-slate-500' : 'text-white')}>
                {energyTotals.total ?? '—'}
              </span>
              <span className="ml-1.5 text-xs text-slate-500">{energyTotals.unit}</span>
            </span>
          </div>

          <div className="flex flex-col gap-3">
            {ENERGY_ITEMS.map(({ key, label, Icon, iconBg, iconColor, valueColor }) => {
              const value = energyTotals[key] ?? '—';
              const unit = energyTotals[`${key}Unit` as keyof EnergyTotals] as string | undefined ?? energyTotals.unit;
              const source = energyTotals[`${key}Source` as keyof EnergyTotals] as EnergySource | undefined;
              const deltaPercent = energyTotals[`${key}DeltaPercent` as keyof EnergyTotals] as number | null | undefined;
              const referenceKwh = energyTotals[`${key}BaselineKwh` as keyof EnergyTotals] as string | undefined;
              const referenceLabel = energyTotals[`${key}ComparisonLabel` as keyof EnergyTotals] as string | undefined;
              return (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={cn('flex size-7 items-center justify-center rounded-md', iconBg)}>
                      <Icon className={cn('size-4', iconColor)} />
                    </div>
                    <span className="text-sm text-slate-300">{label}</span>
                    <SourceTag source={source} />
                  </div>
                  <div className="text-right">
                    <div>
                      {key === 'heating' && energyTotals.heatingPerM2 && (
                        <span className="mr-1.5 text-[11px] text-slate-500">({energyTotals.heatingPerM2} kWh/m²·a)</span>
                      )}
                      <span className={cn('text-xl font-bold leading-none', value === '—' ? 'text-slate-500' : valueColor)}>
                        {value}
                      </span>
                      <span className="ml-1.5 text-[11px] text-slate-500">{unit}</span>
                    </div>
                    <EnergyComparisonNote deltaPercent={deltaPercent} referenceKwh={referenceKwh} referenceLabel={referenceLabel} />
                  </div>
                </div>
              );
            })}

            {/* Thermal efficiency row */}
            <div className="border-t border-slate-700/60 pt-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-md bg-slate-600/50">
                  <Gauge className="size-4 text-slate-300" />
                </div>
                <span className="text-sm text-slate-300">Thermal efficiency</span>
              </div>
              <div className="text-right">
                <span className="text-base font-bold leading-none" style={{ color: thermalRating.color }}>
                  {thermalRating.label}
                </span>
                {mode === 'expert' && (
                  <span className="ml-1.5 text-[11px] text-slate-500">{avgUValue.toFixed(2)} W/m²K</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Technologies — no outer card, the individual tech cards
            already carry their own border/shadow. ── */}
      <div className="shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-md bg-slate-200">
              <CpuIcon className="size-3.5 text-slate-600" />
            </div>
            <p className="text-[13px] font-bold text-slate-800">Technologies</p>
          </div>
          <p className="text-[11px] text-slate-400">Click a card to configure</p>
        </div>
        <TechnologiesSection
          installedTechIds={installedTechIds}
          pvSummary={pvSummary}
          onToggle={onToggleTech}
          onOpen={onOpenTech}
        />
      </div>

    </aside>
    </ScrollHintContainer>
  );
}
