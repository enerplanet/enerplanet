import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Button } from "@spatialhub/ui";
import { useState, type FC } from "react";
import { Loader2, Plus, Trash2, Move } from "lucide-react";

interface TransformerDialogProps {
    open: boolean;
    selectedTransformer: {
        gridResultId: number;
        osmId: string;
        ratedPowerKva: number;
    } | null;
    transformerSizes: { kva: number; cost_eur: number }[];
    onClose: () => void;
    onChangeKva: (kva: number) => void;
    onOpenChange: (open: boolean) => void;
    // New props for add/delete/move transformer
    mode?: 'view' | 'add';
    newTransformerCoords?: [number, number] | null;
    onAddTransformer?: (kva: number) => Promise<void>;
    onDeleteTransformer?: (gridResultId: number) => Promise<void>;
    onMoveTransformer?: (gridResultId: number) => void;
    isUserPlaced?: boolean;
}

export const TransformerDialog: FC<TransformerDialogProps> = ({
    open,
    selectedTransformer,
    transformerSizes,
    onClose,
    onChangeKva,
    onOpenChange,
    mode = 'view',
    newTransformerCoords,
    onAddTransformer,
    onDeleteTransformer,
    onMoveTransformer,
    isUserPlaced = false
}) => {
    const [selectedKva, setSelectedKva] = useState<number>(transformerSizes[0]?.kva || 400);
    const [isLoading, setIsLoading] = useState(false);

    const handleAddTransformer = async () => {
        if (!onAddTransformer) return;
        setIsLoading(true);
        try {
            await onAddTransformer(selectedKva);
            onClose();
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteTransformer = async () => {
        if (!onDeleteTransformer || !selectedTransformer) return;
        setIsLoading(true);
        try {
            await onDeleteTransformer(selectedTransformer.gridResultId);
            onClose();
        } finally {
            setIsLoading(false);
        }
    };

    const handleMoveTransformer = () => {
        if (!onMoveTransformer || !selectedTransformer) return;
        onMoveTransformer(selectedTransformer.gridResultId);
        onClose();
    };

    // Add mode - placing new transformer
    if (mode === 'add' && newTransformerCoords) {
        return (
            <AlertDialog open={open} onOpenChange={onOpenChange}>
                <AlertDialogContent className="max-w-xs !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <Plus className="w-5 h-5" />
                            Add New Transformer
                        </AlertDialogTitle>
                        <AlertDialogDescription className="sr-only">
                            Place a new transformer at the selected location and choose its capacity.
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    <div className="space-y-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span>
                                <span className="text-muted-foreground">Location:</span>{" "}
                                <span className="font-medium">{newTransformerCoords[1].toFixed(6)}, {newTransformerCoords[0].toFixed(6)}</span>
                            </span>
                        </div>

                        <div className="pt-2 border-t">
                            <label className="block text-sm text-muted-foreground mb-1">
                                Select Capacity
                            </label>
                            <Select
                                value={String(selectedKva)}
                                onValueChange={(val) => setSelectedKva(Number(val))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select kVA" />
                                </SelectTrigger>
                                <SelectContent>
                                    {transformerSizes.map((item) => (
                                        <SelectItem key={item.kva} value={String(item.kva)}>
                                            {item.kva} kVA (€{item.cost_eur?.toLocaleString() || 'N/A'})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <AlertDialogFooter className="flex-row gap-2">
                        <Button variant="outline" size="sm" onClick={handleAddTransformer} disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    Adding...
                                </>
                            ) : (
                                <>
                                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                                    Add Transformer
                                </>
                            )}
                        </Button>
                        <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
                            Cancel
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        );
    }

    // View/Edit mode - existing transformer
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent className="max-w-xs !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                        <img src="/images/transformer-icon-dark.svg" alt="" className="w-5 h-5 dark:invert" />
                        Transformer
                        {isUserPlaced && (
                            <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded">
                                User Placed
                            </span>
                        )}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="sr-only">
                        View and modify transformer settings. Changes affect connected buildings.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {selectedTransformer && (
                    <div className="space-y-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            <span>
                                <span className="text-muted-foreground">Grid ID:</span>{" "}
                                <span className="font-medium">{selectedTransformer.gridResultId}</span>
                            </span>
                            {selectedTransformer.osmId && (
                                <span>
                                    <span className="text-muted-foreground">OSM ID:</span>{" "}
                                    <span className="font-medium">{selectedTransformer.osmId}</span>
                                </span>
                            )}
                        </div>

                        <div className="pt-2 border-t">
                            <div className="bg-muted/50 rounded-md p-3 text-xs space-y-2">
                                <div className="font-medium text-sm text-foreground">Voltage Transformation</div>
                                <div className="flex items-center justify-center gap-3 py-2">
                                    <div className="text-center">
                                        <div className="font-bold text-sm text-foreground">20 kV</div>
                                        <div className="text-muted-foreground text-[10px]">Medium Voltage</div>
                                    </div>
                                    <div className="text-muted-foreground text-lg">{'\u2192'}</div>
                                    <div className="text-center">
                                        <div className="font-bold text-sm text-foreground">0.4 kV</div>
                                        <div className="text-muted-foreground text-[10px]">Low Voltage</div>
                                    </div>
                                </div>
                                <div className="text-muted-foreground pt-2 border-t border-border/50 space-y-1">
                                    <div><strong>20 kV (MV):</strong> Medium voltage from utility substation, 3-phase AC power distributed through underground cables or overhead lines</div>
                                    <div><strong>0.4 kV (LV):</strong> Low voltage output - 400V between phases (3-phase) or 230V phase-to-neutral (single-phase) for residential and commercial buildings</div>
                                    <div className="pt-1 text-[10px]">This transformer steps down voltage for safe building distribution while maintaining power capacity.</div>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2 border-t">
                            <label className="block text-sm text-muted-foreground mb-1">
                                Rated Power
                            </label>
                            <Select
                                value={String(selectedTransformer.ratedPowerKva)}
                                onValueChange={(val) => onChangeKva(Number(val))}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select kVA" />
                                </SelectTrigger>
                                <SelectContent>
                                    {transformerSizes.map((item) => (
                                        <SelectItem key={item.kva} value={String(item.kva)}>
                                            {item.kva} kVA
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}

                <AlertDialogFooter className="flex-row gap-2">
                    {isUserPlaced && onMoveTransformer && selectedTransformer && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleMoveTransformer}
                            disabled={isLoading}
                        >
                            <Move className="w-3.5 h-3.5 mr-1.5" />
                            Move
                        </Button>
                    )}
                    {isUserPlaced && onDeleteTransformer && selectedTransformer && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDeleteTransformer}
                            disabled={isLoading}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
                            {isLoading ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                                <>
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    Delete
                                </>
                            )}
                        </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
                        Close
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};
