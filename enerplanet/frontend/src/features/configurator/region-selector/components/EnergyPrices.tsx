import { ChevronDown, ChevronUp, Zap, Flame, Droplet, Leaf, FlaskConical, Euro } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useState } from "react";
import type { FC } from "react";
import type { EnergyPrices as EnergyPricesType } from "@/features/configurator/types/area-select";

interface EnergyPricesProps {
  value: EnergyPricesType;
  onChange: (prices: EnergyPricesType) => void;
}

const PRICE_FIELDS: { key: keyof EnergyPricesType; icon: FC<{ className?: string }> }[] = [
  { key: "electricity_eur_mwh", icon: Zap },
  { key: "natural_gas_eur_mwh", icon: Flame },
  { key: "oil_eur_mwh", icon: Droplet },
  { key: "biomass_eur_mwh", icon: Leaf },
  { key: "biogas_eur_mwh", icon: FlaskConical },
];

export const EnergyPrices: FC<EnergyPricesProps> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const set = (key: keyof EnergyPricesType, raw: string) => {
    const parsed = Number(raw);
    onChange({ ...value, [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 });
  };

  const labelKey: Record<keyof EnergyPricesType, string> = {
    electricity_eur_mwh: "simulation.energyPrices.electricity_eur_mwh",
    natural_gas_eur_mwh: "simulation.energyPrices.natural_gas_eur_mwh",
    oil_eur_mwh: "simulation.energyPrices.oil_eur_mwh",
    biomass_eur_mwh: "simulation.energyPrices.biomass_eur_mwh",
    biogas_eur_mwh: "simulation.energyPrices.biogas_eur_mwh",
  };

  return (
    <div className="bg-background dark:bg-gray-700 border border-border rounded-lg p-3">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between text-sm font-semibold text-foreground cursor-pointer"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          <Euro className="w-4 h-4 text-primary" />
          {t("simulation.energyPrices.title")}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {PRICE_FIELDS.map(({ key, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                {t(labelKey[key])}
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={value[key]}
                onChange={e => set(key, e.target.value)}
                className="w-24 px-2 py-1 text-xs border border-border rounded-lg bg-background text-foreground text-right"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};