import { useMutation, useQuery } from "@tanstack/react-query";
import {
  heatDemandService,
  type HeatDemandResolveRequest,
  type IgnisFieldMetadata,
} from "@/features/configurator/services/heatDemandService";

const heatDemandKeys = {
  fields: ["heat-demand", "ignis-fields"] as const,
  buildingTypes: (countryIso2: string) => ["heat-demand", "ignis-building-types", countryIso2] as const,
};

/**
 * Static, country-independent TABULA field metadata (label/unit/hint) - used
 * to describe the form fields that overlap an ignis input, in the simple form
 * just floor area. Never changes at runtime, so it is fetched once and kept.
 */
export const useIgnisFieldsQuery = () =>
  useQuery({
    queryKey: heatDemandKeys.fields,
    queryFn: heatDemandService.getFields,
    staleTime: Infinity,
  });

/** Looks up one ignis field's metadata by its TABULA key (e.g. "A_C_Ref_Input"). */
export function findIgnisField(
  fields: IgnisFieldMetadata[] | undefined,
  key: string
): IgnisFieldMetadata | undefined {
  return fields?.find((f) => f.key === key);
}

/**
 * The country's real TABULA building types (SFH/TH/MFH/AB - not every country
 * has all four), for the building-type dropdown. Disabled with no country.
 */
export const useIgnisBuildingTypesQuery = (countryIso2: string | undefined) =>
  useQuery({
    queryKey: heatDemandKeys.buildingTypes(countryIso2 ?? ""),
    queryFn: () => heatDemandService.getBuildingTypes(countryIso2 as string),
    enabled: !!countryIso2,
    staleTime: Infinity,
  });

/** Resolves a building's annual heating demand. Stateless - safe to call again
 * whenever the inputs change. */
export const useResolveHeatDemandMutation = () =>
  useMutation({
    mutationFn: (payload: HeatDemandResolveRequest) => heatDemandService.resolve(payload),
  });
