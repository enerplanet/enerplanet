import type { FC } from "react";
import { RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@spatialhub/i18n";
import { TextInfoIcon } from "@/components/ui/InfoTooltip";
import { useModelStore, type ElectricityPrices } from "@/features/configurator/store/modelStore";
import { FALLBACK_COUNTRY, defaultFor, fetchGridPrices, gridPriceError } from "./api";

const INPUT_CLASS = "w-20 px-2 py-1 text-sm text-right bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/** The country the model's region lies in, once the region boundary is known. */
function useRegionCountry(): string | undefined {
  const regionName = useModelStore((s) => s.regionBoundary?.name);
  const regions = useModelStore((s) => s.availableRegions);
  return regions.find((r) => r.name === regionName)?.country;
}

/** The model's purchase price and feed-in tariff, empty where the country default applies. */
export const GridPriceFields: FC = () => {
  const { t } = useTranslation();
  const prices = useModelStore((s) => s.electricityPrices);
  const setPrices = useModelStore((s) => s.setElectricityPrices);
  const country = useRegionCountry();
  const { data: defaults = [] } = useQuery({ queryKey: ["grid-prices"], queryFn: fetchGridPrices, staleTime: 5 * 60_000 });
  const def = country ? defaultFor(defaults, country) : undefined;

  const effectiveImport = prices.import_ct_per_kwh ?? def?.import_ct_per_kwh ?? null;
  const effectiveExport = prices.export_ct_per_kwh ?? def?.export_ct_per_kwh ?? null;
  const errorKey = gridPriceError(effectiveImport, effectiveExport);

  const field = (key: keyof ElectricityPrices, label: string, fallback: number | undefined) => (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-1">
        {prices[key] !== null && (
          <button
            type="button"
            onClick={() => setPrices({ ...prices, [key]: null })}
            title={t("gridPrices.resetToDefault")}
            aria-label={t("gridPrices.resetToDefault")}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <input
          type="number"
          min={0}
          step="0.01"
          aria-label={label}
          className={INPUT_CLASS}
          value={prices[key] ?? ""}
          placeholder={fallback === undefined ? "" : String(fallback)}
          onChange={(e) => setPrices({ ...prices, [key]: e.target.value === "" ? null : Number(e.target.value) })}
        />
        <span className="text-xs text-muted-foreground">ct/kWh</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-foreground">{t("gridPrices.modelTitle")}</span>
        <TextInfoIcon title={t("gridPrices.modelTitle")} description={t("gridPrices.modelHint")} position="fixed-left-anchored" />
      </div>
      {field("import_ct_per_kwh", t("gridPrices.purchase"), def?.import_ct_per_kwh)}
      {field("export_ct_per_kwh", t("gridPrices.feedIn"), def?.export_ct_per_kwh)}
      <p className="text-xs text-muted-foreground">
        {def
          ? t(def.country === FALLBACK_COUNTRY ? "gridPrices.fallbackDefault" : "gridPrices.countryDefault", {
              country: country ?? "",
              import: def.import_ct_per_kwh,
              export: def.export_ct_per_kwh,
            }) + (def.source ? ` ${t("gridPrices.sourceLabel", { source: def.source })}` : "")
          : t("gridPrices.defaultUnknown")}
      </p>
      {errorKey && <p className="text-xs text-red-600 dark:text-red-400">{t(errorKey)}</p>}
    </div>
  );
};
