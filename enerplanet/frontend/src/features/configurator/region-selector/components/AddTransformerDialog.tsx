import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from "@spatialhub/ui";
import { useEffect, useState, type FC } from "react";
import { Check, Loader2, MapPin, Plus, Zap } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";

interface AddTransformerDialogProps {
    open: boolean;
    coords: [number, number] | null;
    transformerSizes: { kva: number; cost_eur: number }[];
    onAdd: (kva: number) => Promise<void>;
    onClose: () => void;
    onOpenChange: (open: boolean) => void;
}

export const AddTransformerDialog: FC<AddTransformerDialogProps> = ({
    open,
    coords,
    transformerSizes,
    onAdd,
    onClose,
    onOpenChange
}) => {
    const { t } = useTranslation();
    const [selectedKva, setSelectedKva] = useState<number>(400);
    const [isLoading, setIsLoading] = useState(false);

    // Reset selection to a sensible default each time the dialog opens
    useEffect(() => {
        if (open) {
            const has400 = transformerSizes.some((s) => s.kva === 400);
            setSelectedKva(has400 ? 400 : transformerSizes[0]?.kva || 400);
        }
    }, [open, transformerSizes]);

    const handleAdd = async () => {
        setIsLoading(true);
        try {
            await onAdd(selectedKva);
            onClose();
        } catch {
            // Parent already shows an error toast - keep the dialog open
        } finally {
            setIsLoading(false);
        }
    };

    const selectedSize = transformerSizes.find((s) => s.kva === selectedKva);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md gap-5">
                <DialogHeader>
                    <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-muted border border-border shrink-0">
                            <img src="/images/transformer-icon-dark.svg" alt="" className="w-5 h-5 dark:invert" />
                        </div>
                        <div className="min-w-0">
                            <DialogTitle className="text-base">
                                {t("simulation.transformer.add", "Add Transformer")}
                            </DialogTitle>
                            <DialogDescription className="mt-0.5">
                                {t(
                                    "simulation.transformer.addSubtitle",
                                    "Choose a capacity for the new transformer"
                                )}
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                {/* Location */}
                {coords && (
                    <div className="flex items-center gap-2 rounded-lg bg-muted/50 border border-border/50 px-3 py-2 text-xs">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">
                            {t("simulation.transformer.location", "Location")}
                        </span>
                        <span className="ml-auto font-mono font-medium tabular-nums">
                            {coords[1].toFixed(5)}, {coords[0].toFixed(5)}
                        </span>
                    </div>
                )}

                {/* Capacity picker */}
                <div>
                    <label className="block text-sm font-medium mb-2">
                        {t("simulation.transformer.selectCapacity", "Select Capacity")}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-0.5">
                        {transformerSizes.map((item) => {
                            const isSelected = item.kva === selectedKva;
                            return (
                                <button
                                    key={item.kva}
                                    type="button"
                                    onClick={() => setSelectedKva(item.kva)}
                                    className={cn(
                                        "relative flex flex-col items-center justify-center rounded-lg border px-2 py-2.5 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isSelected
                                            ? "border-primary bg-primary/5 shadow-sm"
                                            : "border-border/70 hover:border-primary/40 hover:bg-muted/50"
                                    )}
                                >
                                    {isSelected && (
                                        <span className="absolute top-1.5 right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-primary">
                                            <Check className="w-2.5 h-2.5 text-primary-foreground" strokeWidth={3} />
                                        </span>
                                    )}
                                    <span className={cn(
                                        "text-lg font-semibold leading-none tabular-nums",
                                        isSelected ? "text-primary" : "text-foreground"
                                    )}>
                                        {item.kva}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                                        kVA
                                    </span>
                                    <span className="text-[11px] text-muted-foreground mt-1 tabular-nums">
                                        €{item.cost_eur?.toLocaleString() ?? "—"}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Voltage transformation hint */}
                <div className="flex items-center justify-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span>
                        <span className="font-medium text-foreground">20 kV</span>
                        {" → "}
                        <span className="font-medium text-foreground">0.4 kV</span>
                        {" · "}
                        {t("simulation.transformer.voltageHint", "Steps down medium voltage for buildings")}
                    </span>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground tabular-nums">
                        {selectedSize && (
                            <>
                                <span className="font-medium text-foreground">{selectedSize.kva} kVA</span>
                                {selectedSize.cost_eur != null && (
                                    <> · €{selectedSize.cost_eur.toLocaleString()}</>
                                )}
                            </>
                        )}
                    </span>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={onClose} disabled={isLoading}>
                            {t("common.cancel", "Cancel")}
                        </Button>
                        <Button
                            size="sm"
                            onClick={handleAdd}
                            disabled={isLoading || !selectedKva}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                    {t("simulation.transformer.adding", "Adding...")}
                                </>
                            ) : (
                                <>
                                    <Plus className="w-3.5 h-3.5 mr-1.5" />
                                    {t("simulation.transformer.addButton", "Add Transformer")}
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
