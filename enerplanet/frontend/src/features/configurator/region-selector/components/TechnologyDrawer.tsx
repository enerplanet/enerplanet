import { useState, useEffect, type FC } from "react";
import { Battery, Sun, Wind, Leaf, Flame, Snowflake, Droplets, Home, Building2, CircuitBoard, Loader2, SolarPanel, Fan, Zap, Trash2, type LucideIcon } from "lucide-react";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { Button } from "@spatialhub/ui";
import type { Technology } from "@/features/technologies/services/technologyService";
import { ELECTRICITY_TYPES, HEAT_TYPES, defaultProduct, loadCatalogue, productsOfType } from "@/features/technologies/catalogue";
import { ProductCategory } from "./ProductCategory";
import { useTranslation } from "@spatialhub/i18n";

const iconMap: Record<string, LucideIcon> = {
    battery: Battery,
    sun: Sun,
    wind: Wind,
    leaf: Leaf,
    flame: Flame,
    snowflake: Snowflake,
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
    /** Keys of the products some building carries. */
    appliedTechKeys?: string[];
    /** Removes every technology and heat link from every building, after a confirmation. */
    onRemoveAllTechs?: () => void;
    /** Buildings that currently carry a technology or heat link. */
    techBuildingCount?: number;
}

export const TechnologyDrawer: FC<TechnologyDrawerProps> = ({
    isOpen,
    onClose,
    onTechDragStart,
    onTechDragEnd,
    onAddTechToAll,
    onRemoveTechFromAll,
    appliedTechKeys = [],
    onRemoveAllTechs,
    techBuildingCount = 0,
}) => {
    const { t } = useTranslation();
    const confirm = useConfirm();
    const [catalogue, setCatalogue] = useState<Technology[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAnimating, setIsAnimating] = useState(false);
    const [draggedTech, setDraggedTech] = useState<Technology | null>(null);
    const [carrierView, setCarrierView] = useState<CarrierView>("electricity");

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => setIsAnimating(true), 10);
            loadTechnologies();
        }
    }, [isOpen]);

    const loadTechnologies = async () => {
        setLoading(true);
        setCatalogue(await loadCatalogue());
        setLoading(false);
    };

    const handleClose = () => {
        setIsAnimating(false);
        setTimeout(onClose, 300);
    };

    const handleRemoveAll = () =>
        confirm({
            type: "delete",
            title: t("technologies.removeAllConfirmTitle"),
            description: t("technologies.removeAllConfirmDescription", { count: techBuildingCount }),
            confirmLabel: t("technologies.removeAll"),
            onConfirm: async () => onRemoveAllTechs?.(),
        });

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

    const renderCategories = (types: string[]) =>
        types.map((type) => {
            const products = productsOfType(catalogue, type);
            const icon = iconMap[defaultProduct(catalogue, type)?.icon ?? ""] || CircuitBoard;
            return (
                <ProductCategory
                    key={type}
                    type={type}
                    title={t(`technologies.types.${type}`, { defaultValue: type })}
                    icon={icon}
                    products={products}
                    appliedProducts={appliedTechKeys}
                    draggedProduct={draggedTech?.product}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onAddToAll={onAddTechToAll}
                    onRemoveFromAll={onRemoveTechFromAll}
                />
            );
        });
    const hasType = (types: string[]) => types.some((type) => productsOfType(catalogue, type).length > 0);

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

                    {/* Carrier toggle: electricity / heat */}
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

                <div className="px-3 py-4 space-y-3 h-[calc(100vh-290px)] overflow-y-auto">
                    {(() => {
                        if (loading) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.loading")}</p>
                                </div>
                            );
                        }
                        if (carrierView === "heat") {
                            if (!hasType(HEAT_TYPES)) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Flame className="w-8 h-8 text-muted-foreground mb-2" />
                                        <p className="text-sm text-muted-foreground">{t("technologies.noHeatTechnologies")}</p>
                                    </div>
                                );
                            }
                            return renderCategories(HEAT_TYPES);
                        }
                        if (!hasType(ELECTRICITY_TYPES)) {
                            return (
                                <div className="flex flex-col items-center justify-center py-12">
                                    <CircuitBoard className="w-8 h-8 text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">{t("technologies.noTechnologies")}</p>
                                </div>
                            );
                        }
                        return renderCategories(ELECTRICITY_TYPES);
                    })()}
                </div>

                <div className="absolute bottom-0 left-0 right-0 px-3 py-3 border-t border-border bg-background dark:bg-gray-800 space-y-2">
                    {onRemoveAllTechs && (
                        <Button
                            variant="outline"
                            onClick={handleRemoveAll}
                            disabled={techBuildingCount === 0}
                            className="w-full text-red-600 hover:text-red-700 dark:text-red-400"
                        >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t("technologies.removeAll")}
                        </Button>
                    )}
                    <Button variant="outline" onClick={handleClose} className="w-full">
                        {t("common.close")}
                    </Button>
                </div>
            </div>
        </>
    );
};

