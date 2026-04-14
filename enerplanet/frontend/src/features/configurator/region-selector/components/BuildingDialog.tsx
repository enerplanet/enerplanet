import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@spatialhub/ui";
import { Building, Eye, EyeOff, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC } from "react";
import { ALL_F_CLASSES, formatFClassLabel, isResidentialFClass, normalizeFClass } from "@/features/configurator/utils/fClassUtils";
import type { Technology } from "@/features/technologies/services/technologyService";
import technologyService from "@/features/technologies/services/technologyService";
import { useClickOutside } from "@/hooks/useClickOutside";

interface TechData {
    alias: string;
    constraints: { key: string; value: number | string }[];
}

interface FClassDetail {
    fClass: string;
    yearlyDemandKwh: number;
    peakLoadKw: number;
}

interface BuildingDialogProps {
    open: boolean;
    selectedBuilding: {
        osmId: string;
        type: string;
        fClass?: string;
        fClasses?: string[];
        selectedFClass?: string;
        yearlyDemandKwh: number;
        peakLoadKw: number;
        area: number;
        gridResultId?: number;
        techs?: Record<string, TechData>;
        fClassDetails?: FClassDetail[];
        bagId?: string;
        floors3dBag?: number;
        floors?: number;
        heightMax?: number;
        heightMedian?: number;
        heightGround?: number;
        constructionYear?: number;
        energyLabel?: string;
        energyIndex?: number;
        labelDate?: string;
        cbsPopulation?: number;
        cbsHouseholds?: number;
        cbsAvgHouseholdSize?: number;
        householdSize?: number;
        estimatedHouseholds?: number;
        countryCode?: string;
    } | null;
    onClose: () => void;
    onFClassDemandChange: (fClass: string, demand: number) => void;
    onSelectedFClassChange?: (fClass: string) => void;
    onOpenChange: (open: boolean) => void;
    onEditTech?: (techKey: string) => void;
    onRemoveTech?: (techKey: string) => void;
    onFloorsChange?: (floors: number) => void;
    onFloorSelect?: (floor: "all" | number) => void;
    onAreaChange?: (area: number) => void;
    onHouseholdSizeChange?: (householdSize: number) => void;
    onRecalculateDemand?: (floors: number, area: number, householdSize?: number, selectedFloor?: "all" | number, energyLabel?: string, hotWaterElectric?: boolean) => Promise<void>;
    onAddTech?: (tech: Technology) => void;
    onApplyTemplate?: (techs: Record<string, TechData>) => void;
    isMultiEdit?: boolean;
    onToggleMultiEdit?: (value: boolean) => void;
    multiEditCount?: number;
    onApplyTechToAll?: (tech: Technology) => void;
    isExcluded?: boolean;
    onToggleExclude?: (buildingId: number) => void;
}

const hasFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);

const ENERGY_LABELS = ["A", "B", "C", "D", "E", "F", "G"] as const;

const ENERGY_LABEL_COLORS: Record<string, string> = {
    A: "bg-lime-400 text-black",
    B: "bg-lime-300 text-black",
    C: "bg-yellow-300 text-black",
    D: "bg-amber-400 text-black",
    E: "bg-orange-400 text-white",
    F: "bg-red-500 text-white",
    G: "bg-red-700 text-white",
};

/* ── Small read-only field ────────────────────────────────────────── */
const ReadOnlyRow: FC<{ label: string; value: React.ReactNode; unit?: string }> = ({ label, value, unit }) => (
    <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}{unit ? ` ${unit}` : ""}</span>
    </div>
);

export const BuildingDialog: FC<BuildingDialogProps> = ({
    open,
    selectedBuilding,
    onClose,
    onFClassDemandChange,
    onSelectedFClassChange,
    onOpenChange,
    onEditTech,
    onRemoveTech,
    onAreaChange,
    onHouseholdSizeChange,
    onRecalculateDemand,
    onAddTech,
    isExcluded = false,
    onToggleExclude,
}) => {
    const techs = selectedBuilding?.techs || {};
    const techEntries = Object.entries(techs);
    const details = selectedBuilding?.fClassDetails ?? [];

    // Build fClass options: building's detected classes first, then all known classes
    const { detectedClasses, allClasses } = useMemo(() => {
        const candidates = [
            ...details.map((d) => d.fClass),
            ...(selectedBuilding?.fClasses ?? []),
            selectedBuilding?.selectedFClass,
            selectedBuilding?.fClass,
            selectedBuilding?.type,
        ];
        const seen = new Set<string>();
        const detected: string[] = [];
        for (const c of candidates) {
            const normalized = normalizeFClass(String(c ?? ""));
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            detected.push(normalized);
        }
        // Add all known f_classes that aren't already detected
        const remaining: string[] = [];
        for (const fc of ALL_F_CLASSES) {
            if (!seen.has(fc)) {
                seen.add(fc);
                remaining.push(fc);
            }
        }
        return {
            detectedClasses: detected,
            allClasses: remaining,
        };
    }, [details, selectedBuilding?.fClasses, selectedBuilding?.selectedFClass, selectedBuilding?.fClass, selectedBuilding?.type]);

    const fClassOptions = detectedClasses.length > 0
        ? [...detectedClasses, ...allClasses]
        : allClasses.length > 0 ? allClasses : ["unknown"];

    const [selectedFClass, setSelectedFClass] = useState<string>(fClassOptions[0] ?? "unknown");
    const usesHouseholdSize = useMemo(() => isResidentialFClass(selectedFClass), [selectedFClass]);

    // Editable fields
    const floors = selectedBuilding?.floors3dBag ?? selectedBuilding?.floors ?? 1;
    const [editedFloors, setEditedFloors] = useState<number>(floors);
    const [editedArea, setEditedArea] = useState<number>(selectedBuilding?.area ?? 0);
    const [editedHouseholdSize, setEditedHouseholdSize] = useState<number>(
        Math.max(1, Math.round(selectedBuilding?.householdSize ?? selectedBuilding?.cbsAvgHouseholdSize ?? 2)),
    );
    const [editedEnergyLabel, setEditedEnergyLabel] = useState<string>(
        selectedBuilding?.energyLabel?.trim().toUpperCase() || "",
    );
    const [hotWaterElectric, setHotWaterElectric] = useState(false);
    const [isRecalculating, setIsRecalculating] = useState(false);

    const previousOsmIdRef = useRef<string | number | undefined>(undefined);
    useEffect(() => {
        const currentOsmId = selectedBuilding?.osmId;
        if (currentOsmId === previousOsmIdRef.current) return;

        const preferred =
            normalizeFClass(String(selectedBuilding?.selectedFClass ?? "")) ||
            normalizeFClass(String(selectedBuilding?.fClass ?? "")) ||
            fClassOptions[0] || "unknown";
        setSelectedFClass(fClassOptions.includes(preferred) ? preferred : (fClassOptions[0] ?? preferred));

        const f = selectedBuilding?.floors3dBag ?? selectedBuilding?.floors ?? 1;
        setEditedFloors(f);
        setEditedArea(Math.round(selectedBuilding?.area ?? 0));
        setEditedHouseholdSize(Math.max(1, Math.round(selectedBuilding?.householdSize ?? selectedBuilding?.cbsAvgHouseholdSize ?? 2)));
        setEditedEnergyLabel(
            selectedBuilding?.energyLabel?.trim().toUpperCase() || "",
        );
        setHotWaterElectric(false);
        previousOsmIdRef.current = currentOsmId;
    }, [selectedBuilding?.osmId, selectedBuilding?.floors3dBag, selectedBuilding?.floors,
        selectedBuilding?.area, selectedBuilding?.householdSize, selectedBuilding?.cbsAvgHouseholdSize,
        selectedBuilding?.selectedFClass, selectedBuilding?.fClass, selectedBuilding?.energyLabel, fClassOptions]);

    const handleFClassChange = useCallback((value: string) => {
        const normalized = normalizeFClass(value) || value;
        setSelectedFClass(normalized);
        onSelectedFClassChange?.(normalized);
    }, [onSelectedFClassChange]);

    const handleAreaEdit = useCallback((val: number) => {
        const clamped = Math.max(1, Math.round(val));
        setEditedArea(clamped);
        onAreaChange?.(clamped);
    }, [onAreaChange]);

    const handleHouseholdSizeEdit = useCallback((val: number) => {
        const clamped = Math.max(1, Math.round(val));
        setEditedHouseholdSize(clamped);
        onHouseholdSizeChange?.(clamped);
    }, [onHouseholdSizeChange]);

    const handleRecalculate = useCallback(async () => {
        if (!onRecalculateDemand) return;
        setIsRecalculating(true);
        try {
            await onRecalculateDemand(
                editedFloors, editedArea,
                usesHouseholdSize ? editedHouseholdSize : undefined,
                undefined,
                editedEnergyLabel || undefined,
                hotWaterElectric,
            );
        } finally {
            setIsRecalculating(false);
        }
    }, [onRecalculateDemand, editedFloors, editedArea, editedHouseholdSize, usesHouseholdSize, editedEnergyLabel, hotWaterElectric]);

    // Custom building detection
    const isCustomBuilding = useMemo(() => {
        if (!selectedBuilding?.osmId) return false;
        const osmId = selectedBuilding.osmId;
        return typeof osmId === "number" ? osmId < 0 : String(osmId).startsWith("-");
    }, [selectedBuilding?.osmId]);

    const customBuildingId = useMemo(() => {
        if (!isCustomBuilding || !selectedBuilding?.osmId) return null;
        const osmId = selectedBuilding.osmId;
        const numId = typeof osmId === "number" ? osmId : Number.parseInt(String(osmId), 10);
        return Math.abs(numId);
    }, [isCustomBuilding, selectedBuilding?.osmId]);

    // Technology picker
    const techPickerRef = useRef<HTMLDivElement>(null);
    const [showTechPicker, setShowTechPicker] = useState(false);
    const [availableTechs, setAvailableTechs] = useState<Technology[]>([]);
    const [isLoadingTechs, setIsLoadingTechs] = useState(false);
    const closePicker = useCallback(() => setShowTechPicker(false), []);
    useClickOutside(techPickerRef, showTechPicker, closePicker);

    const fetchTechs = useCallback(async () => {
        if (availableTechs.length > 0) return;
        setIsLoadingTechs(true);
        try {
            setAvailableTechs(await technologyService.getAll());
        } catch (err) {
            console.error("Failed to load technologies:", err);
        } finally {
            setIsLoadingTechs(false);
        }
    }, [availableTechs.length]);

    // Country-specific metadata
    const isNL = selectedBuilding?.countryCode === "NL";
    const isCZ = selectedBuilding?.countryCode === "CZ";
    const usesEubucco = !isNL && !!selectedBuilding?.countryCode;

    // Resolve demand values for selected fClass
    const activeFClassDetail = details.find((d) => normalizeFClass(d.fClass) === selectedFClass);
    const yearlyDemand = activeFClassDetail?.yearlyDemandKwh ?? selectedBuilding?.yearlyDemandKwh ?? 0;
    const peakLoad = activeFClassDetail?.peakLoadKw ?? selectedBuilding?.peakLoadKw ?? 0;

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-md !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <Building className="w-5 h-5" />
                        Building Details
                    </AlertDialogTitle>
                    <AlertDialogDescription className="sr-only">
                        View and edit details for the selected building, including type, energy demand, and technologies.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {selectedBuilding && (
                    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                        {/* Basic info chips */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span><span className="text-muted-foreground">OSM:</span> <span className="font-medium">{selectedBuilding.osmId}</span></span>
                            {selectedBuilding.fClass && (
                                <span><span className="text-muted-foreground">Class:</span> <span className="font-medium capitalize">{selectedBuilding.fClass}</span></span>
                            )}
                        </div>

                        {/* fClass selector */}
                        <div className="pt-2 border-t space-y-3">
                            <div>
                                <label className="block text-sm text-muted-foreground mb-1">
                                    Building Type (fClass)
                                </label>
                                <Select value={selectedFClass} onValueChange={handleFClassChange}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-[300px]">
                                        {detectedClasses.length > 0 && (
                                            <>
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Detected</div>
                                                {detectedClasses.map((fc) => (
                                                    <SelectItem key={fc} value={fc}>
                                                        {formatFClassLabel(fc)}
                                                    </SelectItem>
                                                ))}
                                                <div className="my-1 h-px bg-border" />
                                                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">All Types</div>
                                            </>
                                        )}
                                        {allClasses.map((fc) => (
                                            <SelectItem key={fc} value={fc}>
                                                {formatFClassLabel(fc)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Yearly Demand */}
                            <div>
                                <label className="block text-sm text-muted-foreground mb-1">
                                    Yearly Demand (kWh)
                                </label>
                                <input
                                    type="number"
                                    value={Math.round(yearlyDemand)}
                                    onChange={(e) =>
                                        onFClassDemandChange(
                                            activeFClassDetail?.fClass ?? selectedFClass,
                                            Number(e.target.value),
                                        )
                                    }
                                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-sm"
                                />
                            </div>

                            {/* Peak Load */}
                            {hasFiniteNumber(peakLoad) && peakLoad > 0 && (
                                <ReadOnlyRow label="Peak Load" value={peakLoad.toFixed(2)} unit="kW" />
                            )}
                        </div>

                        {/* Building Geometry */}
                        <div className="pt-2 border-t space-y-2">
                            <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                Building Geometry
                            </label>

                            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                {/* Editable: Floor Area */}
                                <div>
                                    <span className="block text-xs text-muted-foreground mb-0.5">Floor Area</span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            value={editedArea}
                                            onChange={(e) => handleAreaEdit(Number(e.target.value))}
                                            min={1}
                                            className="w-full px-2 py-1 border border-border rounded bg-background text-sm tabular-nums"
                                        />
                                        <span className="text-xs text-muted-foreground shrink-0">m²</span>
                                    </div>
                                </div>

                                {/* Editable: Floors */}
                                <div>
                                    <span className="block text-xs text-muted-foreground mb-0.5">Floors</span>
                                    <input
                                        type="number"
                                        value={editedFloors}
                                        onChange={(e) => setEditedFloors(Math.max(1, Math.round(Number(e.target.value))))}
                                        min={1}
                                        className="w-full px-2 py-1 border border-border rounded bg-background text-sm tabular-nums"
                                    />
                                </div>

                                {/* Editable: Household size (residential only) */}
                                {usesHouseholdSize && (
                                    <div>
                                        <span className="block text-xs text-muted-foreground mb-0.5">Household Size</span>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="number"
                                                value={editedHouseholdSize}
                                                onChange={(e) => handleHouseholdSizeEdit(Number(e.target.value))}
                                                min={1}
                                                className="w-full px-2 py-1 border border-border rounded bg-background text-sm tabular-nums"
                                            />
                                            <span className="text-xs text-muted-foreground shrink-0">ppl</span>
                                        </div>
                                    </div>
                                )}

                                {/* Read-only: Construction Year */}
                                {hasFiniteNumber(selectedBuilding.constructionYear) && (
                                    <div>
                                        <span className="block text-xs text-muted-foreground mb-0.5">Constr. Year</span>
                                        <div className="px-2 py-1 border border-border rounded bg-muted/50 text-sm tabular-nums">
                                            {Math.round(selectedBuilding.constructionYear)}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Height data — source depends on country */}
                            {(hasFiniteNumber(selectedBuilding.heightMedian) || hasFiniteNumber(selectedBuilding.heightMax) || hasFiniteNumber(selectedBuilding.heightGround)) && (
                                <div className="mt-1 space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2">
                                    <span className="text-xs font-medium text-muted-foreground">{isNL ? "3D BAG Heights" : isCZ ? "CUZK Heights" : "Building Heights"}</span>
                                    {hasFiniteNumber(selectedBuilding.heightMedian) && (
                                        <ReadOnlyRow label="Height Median" value={selectedBuilding.heightMedian.toFixed(1)} unit="m" />
                                    )}
                                    {hasFiniteNumber(selectedBuilding.heightMax) && (
                                        <ReadOnlyRow label="Height Max" value={selectedBuilding.heightMax.toFixed(1)} unit="m" />
                                    )}
                                    {hasFiniteNumber(selectedBuilding.heightGround) && (
                                        <ReadOnlyRow label="Height Ground" value={selectedBuilding.heightGround.toFixed(1)} unit="m" />
                                    )}
                                </div>
                            )}

                            {/* Energy label selector */}
                            <div className="mt-1 space-y-1">
                                <span className="block text-xs text-muted-foreground mb-0.5">Energy Label</span>
                                <div className="flex items-center gap-2">
                                    <div className="flex gap-1 flex-wrap p-0.5">
                                        {ENERGY_LABELS.map((label) => (
                                            <button
                                                key={label}
                                                type="button"
                                                onClick={() => setEditedEnergyLabel(editedEnergyLabel === label ? "" : label)}
                                                className={`px-3 h-7 rounded border text-xs font-bold whitespace-nowrap transition-all ${
                                                    editedEnergyLabel === label
                                                        ? `${ENERGY_LABEL_COLORS[label]} border-transparent ring-2 ring-offset-1 ring-foreground/30`
                                                        : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                                                }`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {selectedBuilding.energyLabel && selectedBuilding.energyLabel !== editedEnergyLabel && (
                                        <span className="text-[10px] text-muted-foreground">(detected: {selectedBuilding.energyLabel})</span>
                                    )}
                                </div>
                                {hasFiniteNumber(selectedBuilding.energyIndex) && (
                                    <div className="text-xs text-muted-foreground">
                                        Energy Index: <span className="font-medium">{selectedBuilding.energyIndex.toFixed(2)}</span>
                                    </div>
                                )}
                            </div>

                            {/* Electric Hot Water */}
                            <div className="mt-1">
                                <span className="block text-xs text-muted-foreground mb-0.5">Electric Hot Water</span>
                                <div className="flex gap-1">
                                    {([["Yes", true], ["No", false]] as const).map(([label, val]) => (
                                        <button
                                            key={label}
                                            type="button"
                                            onClick={() => setHotWaterElectric(val)}
                                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                                                hotWaterElectric === val
                                                    ? "bg-foreground text-background"
                                                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Recalculate demand */}
                            {onRecalculateDemand && (
                                <div className="flex items-center gap-2 mt-1">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleRecalculate}
                                        disabled={isRecalculating}
                                        className="text-xs"
                                    >
                                        {isRecalculating ? (
                                            <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Recalculating...</>
                                        ) : (
                                            "Recalculate Demand"
                                        )}
                                    </Button>
                                    <span className="text-[10px] text-muted-foreground">
                                        {editedFloors} fl × {editedArea} m² = {(editedFloors * editedArea).toLocaleString()} m²
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Technologies Section */}
                        <div className="pt-2 border-t space-y-2 relative">
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-foreground">
                                    Technologies ({techEntries.length})
                                </label>
                                {onAddTech && (
                                    <button
                                        type="button"
                                        onClick={() => { setShowTechPicker((prev) => !prev); void fetchTechs(); }}
                                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                                        title="Add technology"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add
                                    </button>
                                )}
                            </div>
                            {techEntries.length === 0 ? (
                                <div className="text-xs text-muted-foreground italic py-2">
                                    No technologies added yet.
                                </div>
                            ) : (
                                <div className="space-y-1.5">
                                    {techEntries.map(([techKey, techData]) => {
                                        const firstLetter = (techData.alias || techKey).charAt(0).toUpperCase();
                                        return (
                                            <div
                                                key={techKey}
                                                className="flex items-center justify-between py-1.5 px-2 border border-border rounded bg-muted/20 hover:bg-muted/40 transition-colors"
                                            >
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-6 h-6 rounded-full bg-foreground flex items-center justify-center flex-shrink-0">
                                                        <span className="text-xs font-bold text-background">{firstLetter}</span>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-medium truncate leading-tight">{techData.alias}</div>
                                                        <div className="text-[10px] text-muted-foreground leading-tight">
                                                            {techData.constraints.length} parameters
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                                    {onEditTech && (
                                                        <button
                                                            onClick={() => onEditTech(techKey)}
                                                            className="p-1 hover:bg-muted rounded transition-colors"
                                                            title="Edit parameters"
                                                        >
                                                            <Pencil className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                                                        </button>
                                                    )}
                                                    {onRemoveTech && (
                                                        <button
                                                            onClick={() => onRemoveTech(techKey)}
                                                            className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                                            title="Remove technology"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-red-600" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Tech picker dropdown */}
                            {showTechPicker && (
                                <div ref={techPickerRef} className="absolute right-0 top-8 z-50 w-56 overflow-hidden rounded-lg border border-border bg-background shadow-xl">
                                    <div className="border-b px-3 py-2 text-xs font-semibold text-muted-foreground">
                                        Available Technologies
                                    </div>
                                    <div className="max-h-48 overflow-y-auto">
                                        {isLoadingTechs ? (
                                            <div className="flex items-center justify-center py-4">
                                                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                            </div>
                                        ) : availableTechs.length === 0 ? (
                                            <div className="px-3 py-3 text-sm text-muted-foreground">No technologies available.</div>
                                        ) : (
                                            availableTechs.map((tech) => {
                                                const alreadyAdded = techs[tech.key] !== undefined;
                                                return (
                                                    <button
                                                        key={tech.key}
                                                        type="button"
                                                        disabled={alreadyAdded}
                                                        onClick={() => { setShowTechPicker(false); onAddTech?.(tech); }}
                                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${alreadyAdded ? "cursor-default opacity-40" : "hover:bg-muted"}`}
                                                    >
                                                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                                                            {(tech.alias || tech.key).charAt(0).toUpperCase()}
                                                        </span>
                                                        <span className="flex-1 truncate">{tech.alias}</span>
                                                        {alreadyAdded && <span className="text-[10px] text-muted-foreground">Added</span>}
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* EUBUCCO / Metadata Section */}
                        {(usesEubucco || isNL) && (
                            <div className="pt-2 border-t space-y-2">
                                {isNL && selectedBuilding.labelDate && (
                                    <div className="text-xs text-muted-foreground">
                                        <span className="font-medium">Label Date:</span> {selectedBuilding.labelDate}
                                    </div>
                                )}
                                {isNL && (hasFiniteNumber(selectedBuilding.cbsPopulation) || hasFiniteNumber(selectedBuilding.cbsHouseholds) || hasFiniteNumber(selectedBuilding.cbsAvgHouseholdSize)) && (
                                    <div className="space-y-1 text-xs">
                                        <div className="font-medium text-muted-foreground">CBS / Postcode Data</div>
                                        {hasFiniteNumber(selectedBuilding.cbsPopulation) && (
                                            <div className="flex justify-between"><span className="text-muted-foreground">Population</span><span>{selectedBuilding.cbsPopulation.toLocaleString()}</span></div>
                                        )}
                                        {hasFiniteNumber(selectedBuilding.cbsHouseholds) && (
                                            <div className="flex justify-between"><span className="text-muted-foreground">Households</span><span>{selectedBuilding.cbsHouseholds.toLocaleString()}</span></div>
                                        )}
                                        {hasFiniteNumber(selectedBuilding.cbsAvgHouseholdSize) && (
                                            <div className="flex justify-between"><span className="text-muted-foreground">Avg household size</span><span>{selectedBuilding.cbsAvgHouseholdSize.toFixed(2)}</span></div>
                                        )}
                                    </div>
                                )}
                                {isNL && (
                                    <div className="text-[10px] text-muted-foreground space-y-0.5">
                                        {(hasFiniteNumber(selectedBuilding.heightMedian) || hasFiniteNumber(selectedBuilding.heightMax) || hasFiniteNumber(selectedBuilding.heightGround)) && (
                                            <p>
                                                Heights from{" "}
                                                <a href="https://3dbag.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">3D BAG</a>
                                                {" "}by TU Delft 3D Geoinformation · CC BY 4.0
                                            </p>
                                        )}
                                        {(selectedBuilding.energyLabel || hasFiniteNumber(selectedBuilding.energyIndex)) && (
                                            <p>
                                                Energy labels from{" "}
                                                <a href="https://www.ep-online.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">EP-Online</a>
                                                {" "}· RVO
                                            </p>
                                        )}
                                        {(hasFiniteNumber(selectedBuilding.cbsPopulation) || hasFiniteNumber(selectedBuilding.cbsHouseholds)) && (
                                            <p>
                                                Demographics from{" "}
                                                <a href="https://opendata.cbs.nl" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">CBS Open Data</a>
                                                {" "}· CC BY 4.0
                                            </p>
                                        )}
                                    </div>
                                )}
                                {isCZ && (hasFiniteNumber(selectedBuilding.heightMedian) || hasFiniteNumber(selectedBuilding.heightMax) || hasFiniteNumber(selectedBuilding.heightGround)) && (
                                    <p className="text-[10px] text-muted-foreground">
                                        Heights from{" "}
                                        <a href="https://atom.cuzk.gov.cz" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">ČÚZK LiDAR</a>
                                        {" "}· Czech Office for Surveying, Mapping and Cadastre
                                    </p>
                                )}
                                {usesEubucco && (
                                    <div className="text-xs text-muted-foreground space-y-0.5">
                                        <span>
                                            Building data enriched with{" "}
                                            <a href="https://eubucco.com" target="_blank" rel="noopener noreferrer" className="underline text-blue-500 hover:text-blue-700">EUBUCCO v0.1</a>
                                        </span>
                                        <p className="text-[10px]">
                                            Milojevic-Dupont et al. (2023){" "}
                                            <a href="https://doi.org/10.1038/s41597-023-02040-2" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">doi:10.1038/s41597-023-02040-2</a>
                                            {" · "}Licensed under{" "}
                                            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">CC BY 4.0</a>
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <AlertDialogFooter className="flex-row gap-2">
                    {isCustomBuilding && onToggleExclude && customBuildingId && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={isExcluded ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => onToggleExclude(customBuildingId)}
                                        className={isExcluded ? "bg-amber-600 hover:bg-amber-700" : ""}
                                    >
                                        {isExcluded ? (
                                            <><Eye className="w-3.5 h-3.5 mr-1.5" />Include</>
                                        ) : (
                                            <><EyeOff className="w-3.5 h-3.5 mr-1.5" />Exclude</>
                                        )}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    {isExcluded
                                        ? "Include this custom building in the grid (requires regeneration)"
                                        : "Exclude this custom building from the grid (requires regeneration)"}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                    <Button variant="outline" size="sm" onClick={onClose}>
                        Close
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
