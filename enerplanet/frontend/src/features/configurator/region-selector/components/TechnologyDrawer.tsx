import { useState, useEffect, type FC } from "react";
import { Battery, Sun, Wind, Leaf, Flame, Droplets, Home, Building2, CircuitBoard, Loader2, GripVertical, Plus, Minus, SolarPanel, Fan, type LucideIcon } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import technologyService, { type Technology } from "@/features/technologies/services/technologyService";
import { useTranslation } from "@spatialhub/i18n";

const iconMap: Record<string, LucideIcon> = {
    battery: Battery,
    sun: Sun,
    wind: Wind,
    leaf: Leaf,
    flame: Flame,
    droplets: Droplets,
    home: Home,
    "building-2": Building2,
    "solar-panel": SolarPanel,
    "wind-turbine": Fan,
};

interface TechnologyDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onTechDragStart: (tech: Technology) => void;
    onTechDragEnd: () => void;
    onAddTechToAll?: (tech: Technology) => void;
    onRemoveTechFromAll?: (tech: Technology) => void;
    appliedTechKeys?: string[];
}

export const TechnologyDrawer: FC<TechnologyDrawerProps> = ({
    isOpen,
    onClose,
    onTechDragStart,
    onTechDragEnd,
    onAddTechToAll,
    onRemoveTechFromAll,
    appliedTechKeys = [],
}) => {
    const { t } = useTranslation();
    const [technologies, setTechnologies] = useState<Technology[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAnimating, setIsAnimating] = useState(false);
    const [draggedTech, setDraggedTech] = useState<Technology | null>(null);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsAnimating(true), 10);
            loadTechnologies();
        }
    }, [isOpen]);

    const loadTechnologies = async () => {
        try {
            setLoading(true);
            const data = await technologyService.getAll();
            setTechnologies(data || []);
        } catch (error) {
            console.error("Failed to load technologies:", error);
            // Try to load from fallback
            try {
                const response = await fetch("/initial-data/techs/default_technologies.json");
                if (response.ok) {
                    const data = await response.json();
                    setTechnologies(data.technologies || []);
                }
            } catch {
                // Ignore fallback errors
            }
        } finally {
            setLoading(false);
        }
    };

    const handleClose = () => {
        setIsAnimating(false);
        setTimeout(onClose, 300);
    };

    const handleDragStart = (e: React.DragEvent<HTMLElement>, tech: Technology) => {
        e.dataTransfer.setData("application/json", JSON.stringify(tech));
        e.dataTransfer.effectAllowed = "copy";
        setDraggedTech(tech);
        onTechDragStart(tech);
    };

    const handleDragEnd = () => {
        setDraggedTech(null);
        onTechDragEnd();
    };

    if (!isOpen) return null;

    // Group technologies by type (supply, storage, demand)
    // Include wind_onshore, pv, geothermal, biomass, water as supply technologies
    const supplyTechs = technologies.filter(t => 
        t.key.includes("supply") || 
        t.key.includes("pv_") || 
        t.key.includes("wind_") || 
        t.key.includes("geothermal") || 
        t.key.includes("biomass") || 
        t.key.includes("water_") ||
        t.key.includes("_onshore") ||
        t.key.includes("_offshore")
    );
    const storageTechs = technologies.filter(t => t.key.includes("storage"));
    const otherTechs = technologies.filter(t => 
        !supplyTechs.includes(t) && !storageTechs.includes(t)
    );

    const renderTechCard = (tech: Technology) => {
        const IconComponent = iconMap[tech.icon] || CircuitBoard;
        const isDragged = draggedTech?.key === tech.key;
        const isApplied = appliedTechKeys.includes(tech.key);

        return (
            <div
                key={tech.id || tech.key}
                className={`
                    flex items-center gap-2 p-2.5 rounded-lg border border-border
                    bg-card hover:bg-muted/50 transition-all duration-200
                    ${isDragged ? "opacity-50 scale-95" : "hover:shadow-md"}
                    ${isApplied ? "border-primary/50 bg-primary/5" : ""}
                `}
            >
                {/* Add/Remove to all button */}
                {(onAddTechToAll || onRemoveTechFromAll) && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => {
                                    if (isApplied && onRemoveTechFromAll) {
                                        onRemoveTechFromAll(tech);
                                    } else if (!isApplied && onAddTechToAll) {
                                        onAddTechToAll(tech);
                                    }
                                }}
                                className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                                    isApplied 
                                        ? "bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50" 
                                        : "bg-primary/10 hover:bg-primary/20"
                                }`}
                            >
                                {isApplied ? (
                                    <Minus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                                ) : (
                                    <Plus className="w-3.5 h-3.5 text-primary" />
                                )}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            <p className="text-xs">
                                {isApplied ? "Remove from all buildings" : "Add to all buildings"}
                            </p>
                        </TooltipContent>
                    </Tooltip>
                )}
                
                {/* Draggable area */}
                <button
                    type="button"
                    draggable
                    onDragStart={(e) => handleDragStart(e, tech)}
                    onDragEnd={handleDragEnd}
                    className="flex-1 flex items-center gap-2 cursor-grab active:cursor-grabbing min-w-0 bg-transparent border-none p-0 text-left"
                >
                    <div className="flex-shrink-0 w-7 h-7 rounded-md bg-muted flex items-center justify-center">
                        <IconComponent className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm text-foreground truncate">{tech.alias}</div>
                        <div className="text-[10px] text-muted-foreground">{tech.constraints.length} params</div>
                    </div>
                    <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
            </div>
        );
    };

    const renderSection = (title: string, techs: Technology[]) => {
        if (techs.length === 0) return null;

        return (
            <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                    {title}
                </h4>
                <div className="space-y-2">
                    {techs.map(renderTechCard)}
                </div>
            </div>
        );
    };

    return (
        <>
            <div
                className={`absolute inset-0 bg-black/20 z-20 transition-opacity duration-300 ${
                    isAnimating ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
                onClick={handleClose}
                aria-hidden="true"
            />

            <div
                className={`absolute top-0 right-0 w-full h-full bg-background dark:bg-gray-800 shadow-xl z-30 border-l border-border transition-transform duration-300 ease-in-out ${
                    isAnimating ? "transform translate-x-0" : "transform translate-x-full"
                }`}
            >
                <div className="px-3 pt-4 pb-3 border-b border-border">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-foreground">{t("technologies.title")}</h3>
                        <button
                            onClick={handleClose}
                            className="p-1.5 hover:bg-muted rounded-lg transition-colors text-foreground"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {t("technologies.dragInstruction")}
                    </div>
                </div>

                <div className="px-3 py-4 space-y-6 h-[calc(100vh-180px)] overflow-y-auto">
                    {(() => {
                        if (loading) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.loading")}</p>
                                </div>
                            );
                        }
                        if (technologies.length === 0) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <CircuitBoard className="w-8 h-8 text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.noTechnologies")}</p>
                                </div>
                            );
                        }
                        return (
                            <>
                                {renderSection(t("technologies.categories.supply"), supplyTechs)}
                                {renderSection(t("technologies.categories.storage"), storageTechs)}
                                {renderSection(t("technologies.categories.other"), otherTechs)}
                            </>
                        );
                    })()}
                </div>

                <div className="absolute bottom-0 left-0 right-0 px-3 py-3 border-t border-border bg-background dark:bg-gray-800">
                    <Button variant="outline" onClick={handleClose} className="w-full">
                        {t("common.close")}
                    </Button>
                </div>
            </div>
        </>
    );
};
