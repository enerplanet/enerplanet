import { Building, Loader2 } from "lucide-react";
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
  onCancelAddTransformer: () => void;
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
  onCancelAddTransformer,
}: MapInteractionBannersProps) => {
  const { t } = useTranslation();

  return (
    <>
      {/* Show hint when in add transformer mode */}
      {isAddTransformerMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full pl-2 pr-1.5 py-1.5 shadow-lg">
            <span className="flex items-center justify-center w-7 h-7 rounded-full bg-muted">
              <img
                src="/images/transformer-icon-dark.svg"
                alt=""
                className="w-4 h-4 dark:invert"
              />
            </span>
            <span className="text-sm font-medium text-foreground whitespace-nowrap">
              {t(
                "simulation.transformer.clickToPlace",
                "Click on the map to place the transformer"
              )}
            </span>
            <button
              type="button"
              onClick={onCancelAddTransformer}
              className="px-3 py-1 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
            >
              {t("simulation.transformer.donePlacing", "Done")} (Esc)
            </button>
          </div>
        </div>
      )}

      {/* Show banner when in multi-building assignment mode */}
      {isBuildingAssignMode && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-2 fade-in duration-300">
          <div className="flex items-center gap-3 bg-card/95 backdrop-blur-md border border-border/50 rounded-full pl-2 pr-1.5 py-1.5 shadow-lg">
            {!isAssigning && assignStep === "select-buildings" ? (
              <>
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-muted">
                  <Building className="w-4 h-4 text-foreground" />
                </span>
                <span className="text-sm font-medium text-foreground whitespace-nowrap">
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
                  className="px-3 py-1 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t("simulation.building.nextStep")}
                </button>
                <button
                  type="button"
                  onClick={onCancelAssign}
                  className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                >
                  {t("simulation.building.cancelAssign", "Cancel")} (Esc)
                </button>
              </>
            ) : (
              <>
                {isAssigning ? (
                  <div className="flex items-center gap-2 px-2">
                    <Loader2 className="w-4 h-4 animate-spin text-foreground" />
                    <span className="text-sm font-medium text-foreground whitespace-nowrap">
                      {t("simulation.building.assigningBuildings")}
                    </span>
                  </div>
                ) : (
                  <>
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-muted">
                      <Building className="w-4 h-4 text-foreground" />
                    </span>
                    <span className="text-sm font-medium text-foreground whitespace-nowrap">
                      {t("simulation.building.selectTransformer")}
                    </span>
                    <button
                      type="button"
                      onClick={onBackStep}
                      className="px-2.5 py-1 rounded-full text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                    >
                      ← {t("simulation.building.back", "Back")}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelAssign}
                      className="px-3 py-1 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors"
                    >
                      {t("simulation.building.cancelAssign", "Cancel")} (Esc)
                    </button>
                  </>
                )}
              </>
            )}
          </div>
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
