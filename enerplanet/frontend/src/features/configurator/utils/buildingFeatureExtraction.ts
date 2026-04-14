import { normalizeFClass } from "@/features/configurator/utils/fClassUtils";

type DemandEnergyFallbackMode = "none" | "all" | "custom_only";

const parseFlexibleNumberString = (input: string): number | undefined => {
    const trimmed = input.trim();
    if (!trimmed) return undefined;

    const compact = trimmed.replace(/[\s\u00A0\u202F]/g, "");

    // 1,234.56
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    // 1.234,56
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/\./g, "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    const normalized = compact.includes(",") && !compact.includes(".")
        ? compact.replace(",", ".")
        : compact;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        return parseFlexibleNumberString(value);
    }
    return undefined;
};

const toOptionalString = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined;
    const text = String(value).trim();
    return text.length > 0 ? text : undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => toFiniteNumber(value);

const isCustomBuildingOsmId = (osmId: unknown): boolean => {
    const parsed = toFiniteNumber(osmId);
    if (parsed !== undefined) return parsed < 0;
    const text = String(osmId ?? "").trim().toLowerCase();
    if (!text) return false;
    return text.startsWith("custom_") || text.startsWith("custom/");
};

export const extractBuildingEnrichmentFromProps = (props: Record<string, unknown>) => ({
    countryCode: toOptionalString(
        props.country_code ??
        props.countryCode ??
        props.country,
    ),
    bagId: toOptionalString(
        props.bag_id ??
        props.bagId ??
        props.identificatie ??
        props.BAG_ID ??
        props.BAGPandID ??
        props.BAGPandIDs,
    ),
    floors3dBag: toOptionalNumber(props.floors_3dbag ?? props.b3_floors),
    floors: toOptionalNumber(props.floors ?? props.levels),
    heightMax: toOptionalNumber(props.height_max ?? props.height),
    heightMedian: toOptionalNumber(props.height_median),
    heightGround: toOptionalNumber(props.height_ground),
    constructionYear: toOptionalNumber(
        props.construction_year ??
        props.constructi ??
        props.Constructi ??
        props.year_built ??
        props.yearbuilt ??
        props.oorspronkelijk_bouwjaar ??
        props.oorspronkelijkbouwjaar,
    ),
    energyLabel: toOptionalString(
        props.energy_label ??
        props.energyLabel ??
        props.ep_energy_label ??
        props.labelklasse ??
        props.Energieklasse ??
        props.label,
    ),
    energyIndex: toOptionalNumber(
        props.energy_index ??
        props.energyIndex ??
        props.ep_energy_index ??
        props.EnergieIndex,
    ),
    labelDate: toOptionalString(
        props.label_date ??
        props.labelDate ??
        props.ep_label_date ??
        props.PublicatieDatum,
    ),
    cbsPopulation: toOptionalNumber(
        props.cbs_population ??
        props.cbsPopulation ??
        props.population ??
        props.bevolking ??
        props.inwoners,
    ),
    cbsHouseholds: toOptionalNumber(
        props.cbs_households ??
        props.cbsHouseholds ??
        props.households ??
        props.huishoudens,
    ),
    cbsAvgHouseholdSize: toOptionalNumber(
        props.cbs_avg_household_size ??
        props.cbsAvgHouseholdSize ??
        props.avg_household_size ??
        props.gem_hh_grootte,
    ),
    householdSize: toOptionalNumber(
        props.household_size ??
        props.householdSize ??
        props.people_in_household ??
        props.occupants ??
        props.avg_household_size ??
        props.cbs_avg_household_size,
    ),
    estimatedHouseholds: toOptionalNumber(
        props.estimated_households ??
        props.estimatedHouseholds ??
        props.estimated_households_used,
    ),
});

export const extractYearlyDemandFromProps = (
    props: Record<string, unknown>,
    options: { demandEnergyFallback?: DemandEnergyFallbackMode } = {},
): number => {
    const yearly = toFiniteNumber(props.yearly_demand_kwh ?? props.yearly_consumption_kwh ?? props.demand_energy);
    if (yearly !== undefined) return yearly;

    const fallbackMode = options.demandEnergyFallback ?? "none";
    if (fallbackMode === "all") {
        return toFiniteNumber(props.demand_energy) ?? 0;
    }
    if (fallbackMode === "custom_only" && isCustomBuildingOsmId(props.osm_id)) {
        return toFiniteNumber(props.demand_energy) ?? 0;
    }
    return 0;
};

export const extractPeakLoadFromProps = (props: Record<string, unknown>): number => {
    return toFiniteNumber(props.peak_load_kw ?? props.peak_load_in_kw) ?? 0;
};

export const extractSelectedFClassFromProps = (
    props: Record<string, unknown>,
    fClasses: string[],
    fallbackFClass: string,
): string => {
    const selectedCandidates = [
        props.selected_f_class,
        props.selectedFClass,
        props.active_f_class,
    ];
    for (const candidate of selectedCandidates) {
        const normalized = normalizeFClass(String(candidate ?? ""));
        if (normalized && fClasses.includes(normalized)) {
            return normalized;
        }
    }
    const fallback = normalizeFClass(fallbackFClass);
    if (fallback) return fallback;
    return fClasses[0] ?? "unknown";
};

export const normalizeFClassToken = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const normalized = normalizeFClass(value);
    if (normalized) return normalized;
    return value.trim().toLowerCase();
};
