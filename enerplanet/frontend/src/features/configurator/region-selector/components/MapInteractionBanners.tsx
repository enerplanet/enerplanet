import { Loader2 } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

interface MapInteractionBannersProps {
  isAddTransformerMode: boolean;
  isBuildingAssignMode: boolean;
  isAssigning: boolean;
  assignStep: "select-buildings" | "select-transformer";
  selectedBuildingsForAssign: string[];
  isRunningPowerFlow: boolean;
  onNextStep: () => void;
  onBackStep: () => void;
  onCancelAssign: () => void;
}

export const MapInteractionBanners = ({
  isAddTransformerMode,
  isBuildingAssignMode,
  isAssigning,
  assignStep,
  selectedBuildingsForAssign,
  isRunningPowerFlow,
  onNextStep,
  onBackStep,
  onCancelAssign,
}: MapInteractionBannersProps) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Show hint when in add transformer mode */}
      {isAddTransformerMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          {t(
            "simulation.transformer.clickToPlace",
            "Click inside the polygon to place a transformer"
          )}
        </div>
      )}

      {/* Show banner when in multi-building assignment mode */}
      {isBuildingAssignMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
          {!isAssigning && assignStep === "select-buildings" ? (
            <>
              <span>
                {selectedBuildingsForAssign.length === 0
                  ? t("simulation.building.selectBuildings")
                  : t("simulation.building.selectedCount", {
                      count: selectedBuildingsForAssign.length,
                    })}
              </span>
              <button
                type="button"
                onClick={onNextStep}
                disabled={selectedBuildingsForAssign.length === 0}
                className="px-3 py-1 rounded bg-white text-blue-600 hover:bg-blue-50 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("simulation.building.nextStep")}
              </button>
            </>
          ) : (
            <>
              {isAssigning ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t("simulation.building.assigningBuildings")}</span>
                </div>
              ) : (
                <span>{t("simulation.building.selectTransformer")}</span>
              )}
              <button
                type="button"
                onClick={onBackStep}
                className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs transition-colors"
              >
                ← {t("simulation.building.nextStep").includes("Next") ? "Back" : "Zurück"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onCancelAssign}
            className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 text-xs transition-colors"
          >
            {t("simulation.building.cancelAssign")} (Esc)
          </button>
        </div>
      )}

      {/* Power flow calculating banner */}
      {isRunningPowerFlow && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-40">
          <div className="flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full px-5 py-2.5 shadow-lg">
            <div className="relative w-5 h-5">
              <div className="absolute inset-0 rounded-full border-2 border-amber-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-amber-500 animate-spin" />
            </div>
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
              {t("simulation.powerFlow.calculating")}
            </span>
          </div>
        </div>
      )}
    </>
  );
};
