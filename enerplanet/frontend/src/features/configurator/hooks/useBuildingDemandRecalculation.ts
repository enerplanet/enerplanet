import { useCallback } from "react";
import { normalizeFClass, isResidentialFClass } from "@/features/configurator/utils/fClassUtils";
import { toFiniteNumber } from "@/features/configurator/utils/parsing";
import energyService from "@/features/configurator/services/energyService";
import { useModelStore } from "@/features/configurator/store/modelStore";

interface SelectedBuilding {
  osmId: string;
  selectedFClass?: string;
  fClass?: string;
  type?: string;
  constructionYear?: unknown;
  yearlyDemandKwh?: number;
  peakLoadKw?: number;
  area?: number;
  floors?: number;
  floors3dBag?: number;
  householdSize?: number;
  estimatedHouseholds?: number;
  fClassDetails?: Array<{ fClass: string; yearlyDemandKwh: number; peakLoadKw: number }>;
  fClassDetailsSynthetic?: boolean;
  techs?: Record<string, unknown>;
}

interface BuildingDemandOptions {
  pylovoLayers: {
    updateBuildingProperty: (osmId: string, key: string, value: unknown) => void;
    updateBuildingFClassDemand: (osmId: string, fClass: string, newDemand: number) => void;
  };
  notification: {
    showSuccess: (message: string) => void;
    showError: (message: string) => void;
  };
}

export interface BuildingDemandHandlers {
  handleFClassDemandChange: (fClass: string, newDemand: number) => void;
  handleFloorsChange: (floors: number) => void;
  handleAreaChange: (area: number) => void;
  handleHouseholdSizeChange: (householdSize: number) => void;
  handleRecalculateDemand: (
    floors: number,
    area: number,
    householdSize?: number,
    selectedFloor?: "all" | number,
    energyLabel?: string,
    hotWaterElectric?: boolean
  ) => Promise<void>;
  handleSelectedFClassChange: (fClass: string) => void;
}

export const useBuildingDemandRecalculation = ({
  pylovoLayers,
  notification,
}: BuildingDemandOptions): BuildingDemandHandlers => {
  const selectedBuilding = useModelStore((s) => s.selectedBuilding);
  const setSelectedBuilding = useModelStore((s) => s.setSelectedBuilding);
  // Handle per-f_class demand change via dialog
  const handleFClassDemandChange = useCallback(
    (fClass: string, newDemand: number) => {
      if (!selectedBuilding) return;
      pylovoLayers.updateBuildingFClassDemand(selectedBuilding.osmId, fClass, newDemand);
      setSelectedBuilding((prev: any) => {
        if (!prev) return null;
        const existingDetails =
          prev.fClassDetails && prev.fClassDetails.length > 0
            ? prev.fClassDetails
            : [
              {
                fClass,
                yearlyDemandKwh: prev.yearlyDemandKwh ?? 0,
                peakLoadKw: prev.peakLoadKw ?? 0,
              },
            ];
        let updated = false;
        const updatedDetails = existingDetails.map((d: any) => {
          if (d.fClass !== fClass) return d;
          updated = true;
          return { ...d, yearlyDemandKwh: newDemand };
        });
        if (!updated) {
          updatedDetails.push({ fClass, yearlyDemandKwh: newDemand, peakLoadKw: 0 });
        }
        const newTotal = updatedDetails.reduce(
          (sum: number, d: any) => sum + d.yearlyDemandKwh,
          0
        );
        return { ...prev, fClassDetails: updatedDetails, yearlyDemandKwh: newTotal };
      });
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding]
  );

  // Handle floors change from BuildingDialog
  const handleFloorsChange = useCallback(
    (floors: number) => {
      if (!selectedBuilding) return;
      pylovoLayers.updateBuildingProperty(selectedBuilding.osmId, "floors", floors);
      pylovoLayers.updateBuildingProperty(selectedBuilding.osmId, "floors_3dbag", floors);
      setSelectedBuilding((prev: any) =>
        prev ? { ...prev, floors, floors3dBag: floors } : null
      );
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding]
  );

  // Handle area change from BuildingDialog
  const handleAreaChange = useCallback(
    (area: number) => {
      if (!selectedBuilding) return;
      pylovoLayers.updateBuildingProperty(selectedBuilding.osmId, "area", area);
      setSelectedBuilding((prev: any) => (prev ? { ...prev, area } : null));
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding]
  );

  const handleHouseholdSizeChange = useCallback(
    (householdSize: number) => {
      if (!selectedBuilding) return;
      const activeClass =
        normalizeFClass(String(selectedBuilding.selectedFClass ?? "")) ||
        normalizeFClass(String(selectedBuilding.fClass ?? "")) ||
        normalizeFClass(String(selectedBuilding.type ?? ""));
      if (!isResidentialFClass(activeClass)) return;
      pylovoLayers.updateBuildingProperty(
        selectedBuilding.osmId,
        "household_size",
        householdSize
      );
      setSelectedBuilding((prev: any) =>
        prev ? { ...prev, householdSize } : null
      );
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding]
  );

  // Handle recalculate demand via energy service
  const handleRecalculateDemand = useCallback(
    async (
      floors: number,
      area: number,
      householdSize?: number,
      _selectedFloor?: "all" | number,
      energyLabel?: string,
      hotWaterElectric?: boolean
    ) => {
      if (!selectedBuilding) return;

      const requestedFloors = Math.max(1, Math.round(toFiniteNumber(floors) ?? 1));
      const requestedArea = Math.max(1, toFiniteNumber(area) ?? 1);

      // Always estimate for the full building to ensure consistent results.
      // Per-floor display is handled by dividing the total by number of floors.
      const estimateFloors = requestedFloors;
      const estimateArea = requestedArea * requestedFloors;

      const buildingType =
        normalizeFClass(String(selectedBuilding.selectedFClass ?? "")) ||
        normalizeFClass(String(selectedBuilding.fClass ?? "")) ||
        normalizeFClass(String(selectedBuilding.type ?? "")) ||
        "unknown";
      const selectedFClass =
        normalizeFClass(String(selectedBuilding.selectedFClass ?? "")) ||
        normalizeFClass(String(selectedBuilding.fClass ?? "")) ||
        normalizeFClass(String(buildingType ?? "")) ||
        "unknown";

      const shouldUseHouseholdSize = isResidentialFClass(String(buildingType ?? ""));
      const requestedHousehold = shouldUseHouseholdSize
        ? Math.max(1, Math.round(toFiniteNumber(householdSize) ?? 1))
        : undefined;

      const householdForEstimate = requestedHousehold;
      const yearOfConstruction = toFiniteNumber(selectedBuilding.constructionYear) ?? undefined;
      try {
        const estimate = await energyService.estimateBuildingEnergyDemand(
          buildingType,
          estimateArea,
          householdForEstimate,
          yearOfConstruction,
          estimateFloors,
          energyLabel,
          hotWaterElectric
        );
        const osmId = selectedBuilding.osmId;

        const isSyntheticFClassDetails = Boolean(selectedBuilding.fClassDetailsSynthetic);
        const baseDetails = selectedBuilding.fClassDetails ?? [];
        let updatedDetails: Array<{ fClass: string; yearlyDemandKwh: number; peakLoadKw: number }> =
          [];

        if (isSyntheticFClassDetails) {
          updatedDetails = [
            {
              fClass: selectedFClass,
              yearlyDemandKwh: estimate.yearlyConsumptionKwh,
              peakLoadKw: estimate.peakLoadKw,
            },
          ];
        } else {
          updatedDetails = baseDetails.map(
            (detail: { fClass: string; yearlyDemandKwh: number; peakLoadKw: number }) => ({
              ...detail,
              fClass: normalizeFClass(String(detail.fClass ?? "")) || detail.fClass,
            })
          );
          if (updatedDetails.length === 0) {
            updatedDetails = [
              {
                fClass: selectedFClass,
                yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                peakLoadKw: estimate.peakLoadKw,
              },
            ];
          } else {
            let matchedSelectedClass = false;
            updatedDetails = updatedDetails.map((detail) => {
              const detailClass = normalizeFClass(String(detail.fClass ?? "")) || detail.fClass;
              if (detailClass !== selectedFClass) return detail;
              matchedSelectedClass = true;
              return {
                ...detail,
                fClass: detailClass,
                yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                peakLoadKw: estimate.peakLoadKw,
              };
            });
            if (!matchedSelectedClass) {
              updatedDetails.push({
                fClass: selectedFClass,
                yearlyDemandKwh: estimate.yearlyConsumptionKwh,
                peakLoadKw: estimate.peakLoadKw,
              });
            }
          }
        }

        const totalYearlyDemand = updatedDetails.reduce(
          (sum: number, detail: { yearlyDemandKwh: number }) => sum + (detail.yearlyDemandKwh || 0),
          0
        );
        const totalPeakLoad = updatedDetails.reduce(
          (sum: number, detail: { peakLoadKw: number }) => sum + (detail.peakLoadKw || 0),
          0
        );

        // Update OL feature properties
        pylovoLayers.updateBuildingProperty(osmId, "yearly_demand_kwh", totalYearlyDemand);
        pylovoLayers.updateBuildingProperty(osmId, "demand_energy", totalYearlyDemand);
        pylovoLayers.updateBuildingProperty(osmId, "peak_load_kw", totalPeakLoad);
        pylovoLayers.updateBuildingProperty(osmId, "area", requestedArea);
        pylovoLayers.updateBuildingProperty(osmId, "floors", requestedFloors);
        pylovoLayers.updateBuildingProperty(osmId, "floors_3dbag", requestedFloors);
        if (shouldUseHouseholdSize) {
          pylovoLayers.updateBuildingProperty(
            osmId,
            "household_size",
            estimate.householdSize ?? requestedHousehold
          );
        } else {
          pylovoLayers.updateBuildingProperty(osmId, "household_size", null);
        }
        pylovoLayers.updateBuildingProperty(
          osmId,
          "estimated_households",
          estimate.estimatedHouseholds ?? null
        );
        pylovoLayers.updateBuildingProperty(osmId, "selected_f_class", selectedFClass);

        // Update fclass_details on OL feature
        pylovoLayers.updateBuildingProperty(osmId, "fclass_details", updatedDetails);
        pylovoLayers.updateBuildingProperty(
          osmId,
          "f_class_demands",
          updatedDetails.map(
            (detail: { fClass: string; yearlyDemandKwh: number; peakLoadKw: number }) => ({
              f_class: detail.fClass,
              demand_energy: detail.yearlyDemandKwh,
              peak_load_kw: detail.peakLoadKw,
            })
          )
        );

        // Update local dialog state
        setSelectedBuilding((prev: any) =>
          prev
            ? {
              ...prev,
              yearlyDemandKwh: totalYearlyDemand,
              peakLoadKw: totalPeakLoad,
              area: requestedArea,
              floors: requestedFloors,
              floors3dBag: requestedFloors,
              householdSize: shouldUseHouseholdSize
                ? (estimate.householdSize ?? requestedHousehold)
                : undefined,
              estimatedHouseholds: estimate.estimatedHouseholds,
              selectedFClass,
              fClassDetails: updatedDetails,
              fClassDetailsSynthetic: isSyntheticFClassDetails,
            }
            : null
        );
        notification.showSuccess(
          `Recalculated: ${estimate.yearlyConsumptionKwh.toLocaleString()} kWh/yr (${selectedFClass}), ${estimate.peakLoadKw.toFixed(2)} kW peak`
        );
      } catch (error) {
        console.error("Recalculate demand failed:", error);
        notification.showError("Failed to recalculate energy demand");
      }
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding, notification]
  );

  const handleSelectedFClassChange = useCallback(
    (fClass: string) => {
      if (!selectedBuilding) return;
      const normalized = normalizeFClass(String(fClass ?? "")) || fClass.trim().toLowerCase();
      if (!normalized) return;
      const osmId = selectedBuilding.osmId;
      pylovoLayers.updateBuildingProperty(osmId, "selected_f_class", normalized);
      setSelectedBuilding((prev: any) =>
        prev ? { ...prev, selectedFClass: normalized } : null
      );
    },
    [selectedBuilding, pylovoLayers, setSelectedBuilding]
  );

  return {
    handleFClassDemandChange,
    handleFloorsChange,
    handleAreaChange,
    handleHouseholdSizeChange,
    handleRecalculateDemand,
    handleSelectedFClassChange,
  };
};
