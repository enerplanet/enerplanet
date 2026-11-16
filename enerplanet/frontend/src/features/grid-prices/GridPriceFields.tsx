import { useMemo, type FC } from "react";
import { RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@spatialhub/i18n";
import { TextInfoIcon } from "@/components/ui/InfoTooltip";
import { useModelStore, type ElectricityPrices } from "@/features/configurator/store/modelStore";
import { FALLBACK_COUNTRY, defaultFor, fetchGridPrices, gridPriceError } from "./api";
import { countryAt, gridCentre } from "./regionCountry";

const INPUT_CLASS = "w-20 px-2 py-1 text-sm text-right bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * The country the model's grid lies in: from the listed regions' bounding boxes, else
 * from the region boundary, which depends on an outside geocoding service.
 */
function useRegionCountry(): string | undefined {
  const regionName = useModelStore((s) => s.regionBoundary?.name);
  const regions = useModelStore((s) => s.availableRegions);
  const buildings = useModelStore((s) => s.pylovoGridData?.buildings);
  const centre = useMemo(() => gridCentre(buildings), [buildings]);
  return (centre && countryAt(regions, centre)) ?? regions.find((r) => r.name === regionName)?.country;
}

/**
 * What the two prices mean, and the default of the grid's country with its source once
 * the country is known. Mounted on open, so it refreshes the fields' copy.
 */
const GridPriceDefaults: FC<{ country: string | undefined }> = ({ country }) => {
  const { t } = useTranslation();
  const { data: defaults = [] } = useQuery({ queryKey: ["grid-prices"], queryFn: fetchGridPrices, staleTime: 0 });
  const def = country ? defaultFor(defaults, country) : undefined;
  return (
    <>
      <p>{t("gridPrices.modelHint")}</p>
      {def && (
        <div className="mt-2 space-y-0.5">
          <p className="font-medium capitalize text-gray-900 dark:text-gray-100">
            {def.country === FALLBACK_COUNTRY ? t("gridPrices.otherCountries") : def.country.replace(/_/g, " ")}
          </p>
          <p>{t("gridPrices.purchase")}: <span className="tabular-nums">{def.import_ct_per_kwh}</span> ct/kWh</p>
          <p>{t("gridPrices.feedIn")}: <span className="tabular-nums">{def.export_ct_per_kwh}</span> ct/kWh</p>
          {def.source && <p className="mt-1 whitespace-pre-line">{def.source}</p>}
        </div>
      )}
    </>
  );
};

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
        <TextInfoIcon title={t("gridPrices.modelTitle")} description={<GridPriceDefaults country={country} />} position="fixed-left-anchored" />
      </div>
      {field("import_ct_per_kwh", t("gridPrices.purchase"), def?.import_ct_per_kwh)}
      {field("export_ct_per_kwh", t("gridPrices.feedIn"), def?.export_ct_per_kwh)}
      {!def && <p className="text-xs text-muted-foreground">{t("gridPrices.defaultUnknown")}</p>}
      {errorKey && <p className="text-xs text-red-600 dark:text-red-400">{t(errorKey)}</p>}
    </div>
  );
};
