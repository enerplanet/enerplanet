// Battery storage configuration panel for the Configure view.
// Shown when "Battery" is selected in the Technologies section of the right panel.
// Basic mode exposes sizing; expert mode adds performance and economics sections.

import { useState } from 'react';
import { Battery } from 'lucide-react';
import {
  ConfigSection, NumberInput, FieldLabel, FieldRow, ScrollHintContainer,
} from '@/features/configurator/building-config/panel/shared/ui';
import { cn } from '@spatialhub/ui';
import type { BatteryConfig } from '@/features/configurator/building-config/panel/shared/buildingDefaults';

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function SizingSection({
  battery,
  update,
  mode,
}: {
  battery: BatteryConfig;
  update: (patch: Partial<BatteryConfig>) => void;
  mode: 'basic' | 'expert';
}) {
  // Approximate C-rate (charge rate relative to capacity).
  const cRate = battery.cont_storage_cap_max > 0
    ? (battery.cont_energy_cap_max / battery.cont_storage_cap_max).toFixed(2)
    : '—';

  return (
    <div className="flex flex-col gap-3">
      <FieldRow>
        <div>
          <FieldLabel tip="Maximum charge or discharge power. Determines how quickly the battery can charge from or supply the grid.">
            Max power
          </FieldLabel>
          <NumberInput
            value={battery.cont_energy_cap_max}
            onChange={(v) => update({ cont_energy_cap_max: Math.max(0, v) })}
            unit="kW" min={0} max={10000} step={0.5}
          />
        </div>
        <div>
          <FieldLabel tip="Total usable energy the battery can store.">
            Storage capacity
          </FieldLabel>
          <NumberInput
            value={battery.cont_storage_cap_max}
            onChange={(v) => update({ cont_storage_cap_max: Math.max(0, v) })}
            unit="kWh" min={0} max={100000} step={1}
          />
        </div>
      </FieldRow>

      {/* Basic mode: show the most actionable cost field (price per kWh stored).
          Battery pricing is widely quoted in €/kWh so no conversion is needed —
          the label is simplified but the value maps 1:1 to Calliope's cost_storage_cap. */}
      {mode === 'basic' && (
        <div>
          <FieldLabel tip="Typical installed cost per kWh of storage — this is usually the price given in a battery quote. Used to estimate whether the investment pays off.">
            Battery cost (per kWh stored)
          </FieldLabel>
          <NumberInput
            value={battery.cost_storage_cap}
            onChange={(v) => update({ cost_storage_cap: Math.max(0, v) })}
            unit="€/kWh" min={0} max={5000} step={25}
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border/60 pt-1">
        <span className="text-[11px] text-muted-foreground">C-rate (power / capacity)</span>
        <span className="text-xs font-semibold text-foreground">{cRate} C</span>
      </div>
    </div>
  );
}

function PerformanceSection({
  battery,
  update,
}: {
  battery: BatteryConfig;
  update: (patch: Partial<BatteryConfig>) => void;
}) {
  const roundTripEff = (battery.cont_energy_eff ** 2 * 100).toFixed(1);

  return (
    <div className="flex flex-col gap-3">
      <FieldRow>
        <div>
          <FieldLabel tip="One-way charge or discharge efficiency (0–1). Round-trip efficiency = eff². Typical lithium-ion: 0.95–0.98.">
            One-way efficiency
          </FieldLabel>
          <NumberInput
            value={+(battery.cont_energy_eff * 100).toFixed(1)}
            onChange={(v) => update({ cont_energy_eff: Math.max(0, Math.min(1, v / 100)) })}
            unit="%" min={0} max={100} step={0.5}
          />
        </div>
        <div>
          <FieldLabel tip="Fraction of stored energy lost per hour due to self-discharge. Lithium-ion batteries are typically 0–0.01%/h.">
            Self-discharge
          </FieldLabel>
          <NumberInput
            value={+(battery.cont_storage_loss * 100).toFixed(3)}
            onChange={(v) => update({ cont_storage_loss: Math.max(0, v / 100) })}
            unit="%/h" min={0} max={5} step={0.001}
          />
        </div>
      </FieldRow>
      <div>
        <FieldLabel tip="Minimum state of charge — prevents the battery from fully depleting. 0 = fully dischargeable; 0.2 = 20% minimum reserve.">
          Minimum state of charge
        </FieldLabel>
        <NumberInput
          value={+(battery.cont_storage_discharge_depth * 100).toFixed(0)}
          onChange={(v) => update({ cont_storage_discharge_depth: Math.max(0, Math.min(100, v)) / 100 })}
          unit="%" min={0} max={80} step={5}
        />
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-1">
        <span className="text-[11px] text-muted-foreground">Round-trip efficiency</span>
        <span className="text-xs font-semibold text-foreground">{roundTripEff}%</span>
      </div>
    </div>
  );
}

function EconomicsSection({
  battery,
  update,
}: {
  battery: BatteryConfig;
  update: (patch: Partial<BatteryConfig>) => void;
}) {
  const totalCapex = Math.round(
    battery.cont_energy_cap_max * battery.cost_energy_cap +
    battery.cont_storage_cap_max * battery.cost_storage_cap,
  );

  return (
    <div className="flex flex-col gap-3">
      <FieldRow>
        <div>
          <FieldLabel tip="Capital cost per kW of installed power capacity.">
            Power CapEx
          </FieldLabel>
          <NumberInput
            value={battery.cost_energy_cap}
            onChange={(v) => update({ cost_energy_cap: Math.max(0, v) })}
            unit="€/kW" min={0} max={10000} step={25}
          />
        </div>
        <div>
          <FieldLabel tip="Capital cost per kWh of installed storage capacity.">
            Storage CapEx
          </FieldLabel>
          <NumberInput
            value={battery.cost_storage_cap}
            onChange={(v) => update({ cost_storage_cap: Math.max(0, v) })}
            unit="€/kWh" min={0} max={5000} step={25}
          />
        </div>
      </FieldRow>
      <FieldRow>
        <div>
          <FieldLabel tip="Annual operation and maintenance cost per kW of power capacity.">
            Annual O&amp;M
          </FieldLabel>
          <NumberInput
            value={battery.cost_om_annual}
            onChange={(v) => update({ cost_om_annual: Math.max(0, v) })}
            unit="€/kW/a" min={0} max={500} step={1}
          />
        </div>
        <div>
          <FieldLabel tip="Expected useful lifetime of the system.">
            Lifetime
          </FieldLabel>
          <NumberInput
            value={battery.cont_lifetime}
            onChange={(v) => update({ cont_lifetime: Math.max(1, Math.round(v)) })}
            unit="years" min={1} max={30} step={1}
          />
        </div>
      </FieldRow>
      <FieldRow>
        <div>
          <FieldLabel tip="Annual discount rate used in net-present-value calculations.">
            Interest rate
          </FieldLabel>
          <NumberInput
            value={+(battery.cost_interest_rate * 100).toFixed(2)}
            onChange={(v) => update({ cost_interest_rate: v / 100 })}
            unit="%" min={0} max={20} step={0.25}
          />
        </div>
      </FieldRow>
      <div className="flex items-center justify-between border-t border-border/60 pt-1">
        <span className="text-[11px] text-muted-foreground">Estimated total CapEx</span>
        <span className="text-xs font-semibold text-foreground">€{totalCapex.toLocaleString()}</span>
      </div>
    </div>
  );
}

function InstallToggle({ installed, onToggle }: { installed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={installed}
      className={cn(
        'mb-4 flex w-full items-center justify-between rounded-lg border px-4 py-3.5 text-left transition-colors cursor-pointer',
        installed
          ? 'border-blue-300 bg-blue-50 hover:bg-blue-100'
          : 'border-slate-200 bg-slate-50 hover:bg-slate-100',
      )}
    >
      <div>
        <p className={cn('text-sm font-semibold', installed ? 'text-blue-700' : 'text-slate-700')}>
          {installed ? 'Battery installed' : 'Install battery storage'}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {installed
            ? 'Included in the energy model.'
            : 'Not included — click to add this battery to the energy model.'}
        </p>
      </div>
      <span
        className={cn(
          'inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 border-transparent transition-colors',
          installed ? 'bg-primary' : 'bg-switch-background',
        )}
      >
        <span
          className={cn(
            'block size-6 rounded-full bg-background shadow-sm transition-transform',
            installed ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface BatteryEditorProps {
  battery: BatteryConfig;
  onUpdate: (patch: Partial<BatteryConfig>) => void;
  mode: 'basic' | 'expert';
}

/** Battery storage parameter editor — shown when the Battery entry is selected in the panel. */
export function BatteryEditor({ battery, onUpdate, mode }: BatteryEditorProps) {
  const [expanded, setExpanded] = useState({
    sizing:      true,
    performance: false,
    economics:   false,
  });

  const toggle = (id: keyof typeof expanded) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <ScrollHintContainer className="flex flex-col p-5">

      {/* Header — no right-side control here, so it never collides with the
          modal's own close button in the top-right corner. */}
      <div className="mb-4 flex items-center gap-3 pr-8">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50">
          <Battery className="size-5 text-blue-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-slate-800">Battery Storage</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {battery.cont_storage_cap_max} kWh · {battery.cont_energy_cap_max} kW max power
          </p>
        </div>
      </div>

      <InstallToggle installed={battery.installed} onToggle={() => onUpdate({ installed: !battery.installed })} />

      {/* Parameter sections — dimmed while not installed */}
      <div className={cn('flex flex-col gap-2', !battery.installed && 'pointer-events-none opacity-40')}>

        <ConfigSection title="Sizing" expanded={expanded.sizing} onToggle={() => toggle('sizing')}>
          <SizingSection battery={battery} update={onUpdate} mode={mode} />
        </ConfigSection>

        {mode === 'expert' && (
          <>
            <ConfigSection title="Performance" expanded={expanded.performance} onToggle={() => toggle('performance')}>
              <PerformanceSection battery={battery} update={onUpdate} />
            </ConfigSection>

            <ConfigSection title="Economics" expanded={expanded.economics} onToggle={() => toggle('economics')}>
              <EconomicsSection battery={battery} update={onUpdate} />
            </ConfigSection>
          </>
        )}
      </div>
    </ScrollHintContainer>
  );
}
