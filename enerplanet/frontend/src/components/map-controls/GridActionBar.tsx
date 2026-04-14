import type { FC } from "react";
import { Building2, Activity, Loader2, Check } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { InfoIcon } from "@/components/ui/InfoTooltip";

// Custom transformer icon matching the SVG asset
const TransformerIcon: FC<{ className?: string }> = ({ className }) => (
	<svg className={className} viewBox="0 0 24 24" fill="none">
		<ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor" opacity="0.9"/>
		<rect x="5" y="8" width="14" height="10" fill="currentColor" opacity="0.95"/>
		<ellipse cx="12" cy="18" rx="7" ry="2" fill="currentColor" opacity="0.85"/>
		<rect x="7" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="7.75" cy="2.5" r="1" fill="currentColor"/>
		<rect x="11.25" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="12" cy="2.5" r="1" fill="currentColor"/>
		<rect x="15.5" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="16.25" cy="2.5" r="1" fill="currentColor"/>
	</svg>
);

interface GridActionBarProps {
    hasGridData: boolean;
    isAddTransformerMode: boolean;
    onToggleAddTransformerMode: () => void;
    isBuildingAssignMode: boolean;
    onStartBuildingAssignMode: () => void;
    onRunPowerFlow: () => Promise<boolean>;
    isRunningPowerFlow: boolean;
    hasPowerFlowResults: boolean;
}

export const GridActionBar: FC<GridActionBarProps> = ({
    hasGridData,
    isAddTransformerMode,
    onToggleAddTransformerMode,
    isBuildingAssignMode,
    onStartBuildingAssignMode,
    onRunPowerFlow,
    isRunningPowerFlow,
    hasPowerFlowResults,
}) => {
    const { t } = useTranslation();

    if (!hasGridData) return null;

    return (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 animate-in slide-in-from-bottom-2 fade-in duration-300">
            <div className="flex items-center bg-card/95 backdrop-blur-md border border-border rounded-full shadow-lg">
                {/* Add Transformer */}
                <button
                    type="button"
                    onClick={onToggleAddTransformerMode}
                    className={`
                        flex items-center gap-2 px-4 py-2.5 rounded-l-full transition-colors
                        ${isAddTransformerMode
                            ? "bg-green-500/15 text-green-600 dark:text-green-400"
                            : "text-foreground hover:bg-muted/80"
                        }
                    `}
                >
                    <TransformerIcon className={`w-4 h-4 ${isAddTransformerMode ? "text-green-500" : ""}`} />
                    <span className="text-xs font-medium whitespace-nowrap">
                        {t("workflow.addTransformerAction")}
                    </span>
                    <InfoIcon tooltipKey="addTransformer" position="top" />
                </button>

                <div className="w-px h-6 bg-border/50" />

                {/* Assign Buildings */}
                {!isBuildingAssignMode && (
                    <>
                        <button
                            type="button"
                            onClick={onStartBuildingAssignMode}
                            className="flex items-center gap-2 px-4 py-2.5 text-foreground hover:bg-muted/80 transition-colors"
                        >
                            <Building2 className="w-4 h-4" />
                            <span className="text-xs font-medium whitespace-nowrap">
                                {t("workflow.assignBuildingsAction")}
                            </span>
                            <InfoIcon tooltipKey="assignBuildings" position="top" />
                        </button>

                        <div className="w-px h-6 bg-border/50" />
                    </>
                )}

                {/* Power Flow */}
                <button
                    type="button"
                    onClick={onRunPowerFlow}
                    disabled={isRunningPowerFlow}
                    className={`
                        flex items-center gap-2 px-4 py-2.5 rounded-r-full transition-colors
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${hasPowerFlowResults
                            ? "text-amber-600 dark:text-amber-400 hover:bg-muted/80"
                            : "text-foreground hover:bg-muted/80"
                        }
                    `}
                >
                    {isRunningPowerFlow ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : hasPowerFlowResults ? (
                        <Check className="w-4 h-4 text-green-500" />
                    ) : (
                        <Activity className="w-4 h-4" />
                    )}
                    <span className="text-xs font-medium whitespace-nowrap">
                        {hasPowerFlowResults
                            ? t("workflow.rerunPowerFlowAction")
                            : t("workflow.runPowerFlowAction")
                        }
                    </span>
                    <InfoIcon tooltipKey="powerFlow" position="top" />
                </button>
            </div>
        </div>
    );
};
