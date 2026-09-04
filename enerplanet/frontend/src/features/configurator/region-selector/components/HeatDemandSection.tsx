import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@spatialhub/ui";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FC } from "react";
import {
  useIgnisBuildingTypesQuery,
  useIgnisFieldsQuery,
  useResolveHeatDemandMutation,
  findIgnisField,
} from "@/features/configurator/hooks/useHeatDemandResolve";
import {
  countryNameForIso2,
  type HeatDemandResolveResponse,
} from "@/features/configurator/services/heatDemandService";
import { isResidentialFClass } from "@/features/configurator/utils/fClassUtils";

const SOURCE_LABEL: Record<HeatDemandResolveResponse["source"], string> = {
  buem: "measured",
  ignis: "TABULA archetype",
  estimate: "estimate",
};

interface HeatDemandSectionProps {
  osmId: string;
  fClass: string;
  countryCode?: string;
  areaSqm: number;
  initialConstructionYear?: number;
  onResolved: (result: HeatDemandResolveResponse) => void;
}

/**
 * Resolves a building's annual space-heating demand via
 * POST /api/v1/heat-demand/resolve. Collects only what the resolve endpoint
 * cannot derive itself: building type and construction year (floor area and
 * country are already known from the building). No climate overrides, no
 * timeseries upload option in this simple form.
 */
export const HeatDemandSection: FC<HeatDemandSectionProps> = ({
  osmId,
  fClass,
  countryCode,
  areaSqm,
  initialConstructionYear,
  onResolved,
}) => {
  const countryName = countryNameForIso2(countryCode);
  const isResidential = isResidentialFClass(fClass);

  const [buildingType, setBuildingType] = useState<string>("");
  const [constructionYear, setConstructionYear] = useState<string>(
    initialConstructionYear ? String(initialConstructionYear) : ""
  );
  const [result, setResult] = useState<HeatDemandResolveResponse | null>(null);

  useEffect(() => {
    if (initialConstructionYear) setConstructionYear(String(initialConstructionYear));
  }, [initialConstructionYear]);

  const buildingTypesQuery = useIgnisBuildingTypesQuery(isResidential ? countryCode : undefined);
  const fieldsQuery = useIgnisFieldsQuery();
  const floorAreaField = findIgnisField(fieldsQuery.data, "A_C_Ref_Input");

  const resolveMutation = useResolveHeatDemandMutation();

  const handleResolve = () => {
    const year = Number(constructionYear);
    resolveMutation.mutate(
      {
        osm_id: osmId,
        f_class: fClass,
        building_type: buildingType || undefined,
        construction_year: Number.isFinite(year) && year > 0 ? year : undefined,
        floor_area_m2: areaSqm,
        country: countryName,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          onResolved(data);
        },
      }
    );
  };

  return (
    <div className="pt-2 border-t space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Heat Demand
      </label>

      {isResidential && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <span className="block text-xs text-muted-foreground mb-0.5">Building Type</span>
            <Select value={buildingType} onValueChange={setBuildingType}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue placeholder={buildingTypesQuery.isLoading ? "Loading…" : "Select"} />
              </SelectTrigger>
              <SelectContent>
                {(buildingTypesQuery.data ?? []).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="block text-xs text-muted-foreground mb-0.5">Construction Year</span>
            <input
              type="number"
              value={constructionYear}
              onChange={(e) => setConstructionYear(e.target.value)}
              placeholder="e.g. 1975"
              className="w-full px-2 py-1 border border-border rounded bg-background text-sm tabular-nums"
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {floorAreaField?.label ?? "Floor area"}: {Math.round(areaSqm).toLocaleString()}{" "}
        {floorAreaField?.unit ?? "m²"}
        {countryName ? ` · ${countryName}` : ""}
      </p>

      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={handleResolve}
        disabled={resolveMutation.isPending || areaSqm <= 0}
      >
        {resolveMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
        Resolve heating demand
      </Button>

      {result && (
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              Annual Heating Demand
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                {SOURCE_LABEL[result.source]}
              </span>
            </span>
            <span className="font-medium tabular-nums">
              {Math.round(result.heating_demand_kwh_a).toLocaleString()} kWh
            </span>
          </div>
          {result.tabula_variant_code && (
            <p className="text-xs text-muted-foreground">Variant: {result.tabula_variant_code}</p>
          )}
          {result.warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-600 dark:text-amber-400">
              {warning}
            </p>
          ))}
        </div>
      )}

      {resolveMutation.isError && (
        <p className="text-xs text-destructive">Could not resolve heating demand. Try again.</p>
      )}
    </div>
  );
};
