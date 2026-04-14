import type { FC } from "react";
import { Activity } from "lucide-react";
import { ColorConfig } from "@/constants/color-config";

interface CustomTransformer {
    gridResultId: number;
    osmId: string;
    buildingCount: number;
}

interface PowerFlowLegendProps {
    visible: boolean;
    customTransformers?: CustomTransformer[];
    onTransformerClick?: (gridResultId: number) => void;
}

const loadUtilizationSteps = [
    { label: "0–40%", color: ColorConfig.load_utilization_low, description: "Low" },
    { label: "40–60%", color: ColorConfig.load_utilization_moderate, description: "Moderate" },
    { label: "60–80%", color: ColorConfig.load_utilization_medium, description: "Medium" },
    { label: "80–100%", color: ColorConfig.load_utilization_high, description: "High" },
    { label: ">100%", color: ColorConfig.load_utilization_critical, description: "Overloaded" },
];

export const PowerFlowLegend: FC<PowerFlowLegendProps> = ({ 
    visible, 
    customTransformers = [],
    onTransformerClick 
}) => {
    if (!visible) return null;

    return (
        <div className="absolute bottom-10 left-3 z-30">
            <div className="bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-lg p-3 w-52">
                {/* Custom Transformers section - shown first if any exist */}
                {customTransformers.length > 0 && (
                    <div className="space-y-1.5 mb-3 pb-3 border-b border-border">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Custom Transformers
                        </div>
                        <div className="space-y-1 max-h-24 overflow-y-auto">
                            {customTransformers.map((transformer, index) => (
                                <button
                                    key={transformer.gridResultId}
                                    onClick={() => onTransformerClick?.(transformer.gridResultId)}
                                    className="flex items-center gap-2 w-full text-left hover:bg-muted/50 rounded px-1 py-0.5 transition-colors"
                                >
                                    <img 
                                        src="/images/transformer-icon.svg" 
                                        alt="Transformer"
                                        className="w-4 h-4"
                                        style={{ 
                                            filter: 'invert(45%) sepia(98%) saturate(1000%) hue-rotate(5deg) brightness(95%)'
                                        }}
                                    />
                                    <span className="text-[10px] text-foreground flex-1">
                                        Transformer {index + 1}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {transformer.buildingCount} bldg{transformer.buildingCount !== 1 ? 's' : ''}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-1.5 mb-2">
                    <Activity className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-foreground">Load Utilization</span>
                </div>

                {/* Cable Lines color scale */}
                <div className="space-y-1.5 mb-3">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Cable Lines
                    </div>
                    <div className="flex rounded overflow-hidden h-2.5">
                        {loadUtilizationSteps.map((step) => (
                            <div
                                key={step.label}
                                className="flex-1"
                                style={{ backgroundColor: step.color }}
                                title={`${step.description} (${step.label})`}
                            />
                        ))}
                    </div>
                    <div className="flex justify-between text-[9px] text-muted-foreground">
                        <span>0%</span>
                        <span>40%</span>
                        <span>60%</span>
                        <span>80%</span>
                        <span>100%+</span>
                    </div>
                </div>

                {/* MV Lines */}
                <div className="space-y-1 mb-2">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        MV Lines
                    </div>
                    <div className="flex items-center gap-2">
                        <div
                            className="w-8 h-1 rounded-full"
                            style={{
                                backgroundColor: ColorConfig.power_line_medium_voltage,
                                boxShadow: `0 0 6px ${ColorConfig.power_line_medium_voltage}`,
                            }}
                        />
                        <span className="text-[10px] text-foreground">Medium voltage feed</span>
                    </div>
                </div>

                {/* Transformer markers */}
                <div className="space-y-1">
                    <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Transformers
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex h-2.5 w-8 rounded overflow-hidden border border-border">
                            <div className="flex-1" style={{ backgroundColor: ColorConfig.load_utilization_low }} />
                            <div className="flex-1" style={{ backgroundColor: ColorConfig.load_utilization_high }} />
                        </div>
                        <span className="text-[10px] text-foreground">Capacity bar</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
