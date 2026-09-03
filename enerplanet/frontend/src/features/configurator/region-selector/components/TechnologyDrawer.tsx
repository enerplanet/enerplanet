import { useState, useEffect, type FC } from "react";
import { Battery, Sun, Wind, Leaf, Flame, Droplets, Home, Building2, CircuitBoard, Loader2, GripVertical, Plus, Minus, SolarPanel, Fan, Zap, Search, type LucideIcon } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import technologyService, { type Technology } from "@/features/technologies/services/technologyService";
import { fetchOpenTechHeatTechnologies, fetchOpenTechElectricityTechnologies } from "@/features/configurator/services/opentechdbService";
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

type CarrierView = "electricity" | "heat";

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
    const [heatTechnologies, setHeatTechnologies] = useState<Technology[]>([]);
    const [otdbElectricity, setOtdbElectricity] = useState<Technology[]>([]);
    const [loading, setLoading] = useState(true);
    // Client-side search across the active carrier's techs (catalog is small
    // and cached — no server-side filtering needed).
    const [search, setSearch] = useState("");
    const [isAnimating, setIsAnimating] = useState(false);
    const [draggedTech, setDraggedTech] = useState<Technology | null>(null);
    // Carrier view: electricity = simulator techs (DB table), heat = OpenTech-DB.
    // Heat is always available for now; the energyVectors gate arrives with the
    // model-builder.
    const [carrierView, setCarrierView] = useState<CarrierView>("electricity");

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsAnimating(true), 10);
            loadTechnologies();
        }
    }, [isOpen]);

    const loadTechnologies = async () => {
        try {
            setLoading(true);
            const [data, heatTechs, otdbElek] = await Promise.all([
                technologyService.getAll(),
                fetchOpenTechHeatTechnologies(),
                fetchOpenTechElectricityTechnologies(),
            ]);
            setTechnologies(data || []);
            setHeatTechnologies(heatTechs || []);
            setOtdbElectricity(otdbElek || []);
        } catch (error) {
            console.error("Failed to load technologies:", error);
            // Simulator fallback: static JSON. Heat list degrades to its own
            // fallback inside the service, so nothing else needed here.
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

    const q = search.trim().toLowerCase();
    const matches = (tech: Technology): boolean =>
      q === "" ||
      tech.alias.toLowerCase().includes(q) ||
      tech.key.toLowerCase().includes(q);

    const renderTechCard = (tech: Technology, isOtdb = false) => {
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
                        <div className="flex items-center gap-1.5">
                            <span className="font-medium text-sm text-foreground truncate">{tech.alias}</span>
                            {isOtdb && (
                                <span className="flex-shrink-0 text-[9px] px-1 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 font-medium">
                                    OTDB
                                </span>
                            )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{tech.constraints.length} params</div>
                    </div>
                    <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </button>
            </div>
        );
    };

    const renderSection = (title: string, techs: Technology[], isOtdb = false) => {
        if (techs.length === 0) return null;

        return (
            <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
                    {title}
                </h4>
                <div className="space-y-2">
                    {techs.map((tech) => renderTechCard(tech, isOtdb))}
                </div>
            </div>
        );
    };

    // Simulator techs grouped by category (electricity view)
    const supplyTechs = technologies.filter(t =>
        (t.key.includes("supply") ||
        t.key.includes("pv_") ||
        t.key.includes("wind_") ||
        t.key.includes("geothermal") ||
        t.key.includes("biomass") ||
        t.key.includes("water_") ||
        t.key.includes("_onshore") ||
        t.key.includes("_offshore")) && matches(t)
    );
    const storageTechs = technologies.filter(t => t.key.includes("storage") && matches(t));
    const otherTechs = technologies.filter(t =>
        !supplyTechs.includes(t) && !storageTechs.includes(t) && matches(t)
    );

    // OpenTech-DB heat techs grouped by category (heat view)
    const otdbConversion = heatTechnologies.filter(t => (t as { otdbCategory?: string }).otdbCategory === "conversion" && matches(t));
    const otdbStorage = heatTechnologies.filter(t => (t as { otdbCategory?: string }).otdbCategory === "storage" && matches(t));
    const otdbOther = heatTechnologies.filter((t) => {
        const cat = (t as { otdbCategory?: string }).otdbCategory;
        return cat !== "conversion" && cat !== "storage" && matches(t);
    });
    const otdbElekFiltered = otdbElectricity.filter(matches);

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

                    {/* Search */}
                    <div className="relative mt-3">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t("technologies.searchPlaceholder")}
                            className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground outline-none focus:border-primary"
                        />
                    </div>

                    {/* Carrier toggle: electricity (simulator) / heat (OpenTech-DB) */}
                    <div
                        className="mt-3 flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
                        role="tablist"
                        aria-label={t("technologies.carrierToggleLabel")}
                    >
                        {([
                            ["electricity", t("technologies.carriers.electricity")],
                            ["heat", t("technologies.carriers.heat")],
                        ] as [CarrierView, string][]).map(([view, label]) => (
                            <button
                                key={view}
                                role="tab"
                                aria-selected={carrierView === view}
                                onClick={() => setCarrierView(view)}
                                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-all duration-150 ${
                                    carrierView === view
                                        ? "bg-card text-foreground shadow-sm border border-border"
                                        : "text-muted-foreground hover:text-foreground border border-transparent"
                                }`}
                            >
                                {view === "heat"
                                    ? <Flame className={`h-3.5 w-3.5 ${carrierView === "heat" ? "text-orange-500" : "text-muted-foreground"}`} />
                                    : <Zap className={`h-3.5 w-3.5 ${carrierView === "electricity" ? "text-primary" : "text-muted-foreground"}`} />}
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="px-3 py-4 space-y-6 h-[calc(100vh-240px)] overflow-y-auto">
                    {(() => {
                        if (loading) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.loading")}</p>
                                </div>
                            );
                        }
                        const noSearchResults =
                            search.trim() !== "" &&
                            supplyTechs.length === 0 && storageTechs.length === 0 && otherTechs.length === 0 &&
                            otdbConversion.length === 0 && otdbStorage.length === 0 && otdbOther.length === 0;
                        if (noSearchResults) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Search className="w-8 h-8 text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.noSearchResults")}</p>
                                </div>
                            );
                        }
                        if (carrierView === "heat") {
                            if (heatTechnologies.length === 0) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Flame className="w-8 h-8 text-muted-foreground mb-2" />
                                        <p className="text-sm text-muted-foreground">{t("technologies.noHeatTechnologies")}</p>
                                    </div>
                                );
                            }
                            return (
                                <>
                                    <p className="text-[10px] text-muted-foreground px-1">
                                        {t("technologies.heatSourceHint")}
                                    </p>
                                    {renderSection(t("technologies.categories.conversion"), otdbConversion, true)}
                                    {renderSection(t("technologies.categories.storage"), otdbStorage, true)}
                                    {renderSection(t("technologies.categories.networks"), otdbOther, true)}
                                </>
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
                                {otdbElectricity.length > 0 && (
                                    <div className="pt-2 border-t border-border">
                                        <p className="text-[10px] text-muted-foreground px-1 mb-2">
                                            {t("technologies.otdbElectricityHint")}
                                        </p>
                                        {renderSection(t("technologies.categories.otdbAdditions"), otdbElekFiltered, true)}
                                    </div>
                                )}
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

