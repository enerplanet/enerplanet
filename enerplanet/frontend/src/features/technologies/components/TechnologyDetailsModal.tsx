import { useEffect, useRef } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Button, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { CheckCircle, Loader2, LucideIcon, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import ParameterInfoTooltip from "./ParameterInfoTooltip";
import { Technology, TechnologyConstraint } from "@/features/technologies/services/technologyService";

interface TechnologyDetailsModalProps {
  open: boolean;
  selectedTech: Technology | null;
  onClose: () => void;
  editedConstraints: TechnologyConstraint[];
  editingIndex: number | null;
  setEditingIndex: (index: number | null) => void;
  updateEditedConstraint: (index: number, field: keyof TechnologyConstraint, value: string | number | null) => void;
  formatValue: (value: number | string) => string;
  canEditTech: (tech: Technology) => boolean;
  canDeleteConstraint: (tech: Technology) => boolean;
  handleDeleteConstraint: (constraintId: number, constraintAlias: string) => void;
  deletingConstraint: number | null;
  saveEditedConstraints: () => Promise<void>;
  setShowAddParamModal: (open: boolean) => void;
  iconMap: Record<string, LucideIcon>;
  savingDetails: boolean;
}

function TechnologyDetailsModal({
  open,
  selectedTech,
  onClose,
  editedConstraints,
  editingIndex,
  setEditingIndex,
  updateEditedConstraint,
  formatValue,
  canEditTech,
  canDeleteConstraint,
  handleDeleteConstraint,
  deletingConstraint,
  saveEditedConstraints,
  setShowAddParamModal,
  iconMap,
  savingDetails,
}: Readonly<TechnologyDetailsModalProps>) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open && selectedTech) {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && !contentRef.current?.contains(activeEl)) {
        activeEl.blur();
      }
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
  }, [open, selectedTech]);

  const blurActiveElement = () => {
    const activeEl = document.activeElement as HTMLElement | null;
    if (activeEl && !contentRef.current?.contains(activeEl)) {
      activeEl.blur();
    }
  };
  const handleClose = () => {
    blurActiveElement();
    onClose();
  };

  if (!selectedTech) return null;

  const IconComponent = iconMap[selectedTech.icon] || Settings2;
  const isEditable = canEditTech(selectedTech);

  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <AlertDialogContent
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          closeButtonRef.current?.focus();
        }}
        className="sm:max-w-2xl p-5"
      >
        <AlertDialogDescription className="sr-only">{t('technologies.detailsModal.viewAndEdit')}</AlertDialogDescription>
        <Button
          ref={closeButtonRef}
          disabled={savingDetails}
          onClick={handleClose}
          variant="ghost"
          size="icon"
          className="absolute z-10 right-3 top-3 size-8 justify-center items-center flex cursor-pointer rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <X className="size-4" />
        </Button>

        <AlertDialogHeader className="pr-10">
          <AlertDialogTitle className="flex items-center gap-2.5 text-xl">
            <span className="w-9 h-9 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-200 dark:to-gray-400 rounded-xl flex items-center justify-center shadow-lg">
              <IconComponent className="w-4.5 h-4.5 text-white dark:text-gray-900" />
            </span>
            {selectedTech.alias}
          </AlertDialogTitle>
          <AlertDialogDescription className="mt-1">{selectedTech.description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="relative max-h-[60dvh] overflow-auto no-scrollbar border-y border-border py-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">{t('technologies.parameters')}</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
                {editedConstraints.length} {t('technologies.total')}
              </span>
              {isEditable && (
                <button
                  onClick={() => {
                    blurActiveElement();
                    setShowAddParamModal(true);
                  }}
                  className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-2 py-1 bg-primary/10 hover:bg-primary/20 rounded-md transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  {t('technologies.addParameter')}
                </button>
              )}
            </div>
          </div>

          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/50">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-foreground">{t('technologies.form.parameter')}</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground">{t('technologies.form.defaultValue')}</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground">{t('technologies.form.unit')}</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-foreground">{t('technologies.form.range')}</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-foreground w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {editedConstraints.map((constraint, index) => (
                  <tr key={constraint.key} className="hover:bg-muted/30 transition-colors">
                    {editingIndex === index && isEditable ? (
                      <>
                        <td className="px-4 py-3">
                          <p className="text-sm text-foreground">{constraint.alias}</p>
                          <p className="text-xs text-muted-foreground font-mono">{constraint.key}</p>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            step="any"
                            value={constraint.default_value}
                            onChange={(e) => updateEditedConstraint(index, "default_value", e.target.value)}
                            className="w-full px-2 py-1 bg-background border border-border rounded text-sm text-foreground text-right focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="text"
                            value={constraint.unit || ""}
                            onChange={(e) => updateEditedConstraint(index, "unit", e.target.value || null)}
                            placeholder="—"
                            className="w-full px-2 py-1 bg-background border border-border rounded text-xs text-foreground text-right placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <input
                              type="number"
                              step="any"
                              value={constraint.min ?? ""}
                              onChange={(e) => updateEditedConstraint(index, "min", e.target.value !== "" ? e.target.value : null)}
                              placeholder="-∞"
                              className="w-16 px-2 py-1 bg-background border border-border rounded text-xs text-foreground text-right placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <span className="text-xs text-muted-foreground">→</span>
                            <input
                              type="text"
                              value={constraint.max === "INF" ? "INF" : constraint.max ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "INF" || val === "∞" || val.toUpperCase() === "INF") {
                                  updateEditedConstraint(index, "max", "INF");
                                } else {
                                  updateEditedConstraint(index, "max", val !== "" ? val : null);
                                }
                              }}
                              placeholder="∞"
                              className="w-16 px-2 py-1 bg-background border border-border rounded text-xs text-foreground text-right placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
                          >
                            <CheckCircle className="w-4 h-4 text-primary" />
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <p className="text-sm text-foreground">{constraint.alias}</p>
                              <p className="text-xs text-muted-foreground font-mono">{constraint.key}</p>
                            </div>
                            <ParameterInfoTooltip alias={constraint.alias} paramKey={constraint.key} description={constraint.description} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-medium text-foreground">
                            {constraint.relationData && typeof constraint.relationData === 'object' 
                              ? <span className="text-xs text-muted-foreground italic">{t('technologies.detailsModal.selectFromOptions', { count: Object.keys(constraint.relationData).length })}</span>
                              : formatValue(constraint.default_value)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground">{constraint.unit || "—"}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground">
                            {(() => {
                              if (constraint.min === null && constraint.max === null) return "—";
                              const minStr = constraint.min === null ? "-∞" : formatValue(constraint.min);
                              const maxStr = constraint.max === null ? "∞" : formatValue(constraint.max);
                              return `${minStr} → ${maxStr}`;
                            })()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isEditable && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => setEditingIndex(index)}
                                    className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                                  >
                                    <Pencil className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t('technologies.editParameter')}</TooltipContent>
                              </Tooltip>
                            )}
                            {canDeleteConstraint(selectedTech) && constraint.id && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() => handleDeleteConstraint(constraint.id!, constraint.alias)}
                                    disabled={deletingConstraint === constraint.id}
                                    className="p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                                  >
                                    {deletingConstraint === constraint.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin text-gray-500 dark:text-gray-400" />
                                    ) : (
                                      <Trash2 className="w-4 h-4 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>{t('technologies.deleteParameter')}</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <AlertDialogFooter className="pt-4 gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            className="rounded-xl cursor-pointer text-sm h-10 px-5 font-medium text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            {isEditable ? t('technologies.detailsModal.cancel') : t('technologies.detailsModal.close')}
          </Button>
          {isEditable && (
            <Button
              variant="default"
            onClick={saveEditedConstraints}
            disabled={savingDetails}
            className="rounded-xl cursor-pointer text-sm h-10 px-6 font-medium min-w-[calc(var(--spacing)_*_20)] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          >
            {savingDetails ? <Loader2 className="w-4 h-4 animate-spin" /> : t('technologies.detailsModal.saveChanges')}
          </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default TechnologyDetailsModal;
