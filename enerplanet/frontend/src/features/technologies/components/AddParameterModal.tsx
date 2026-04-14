import { useRef, useEffect } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { Technology, TechnologyConstraint } from "@/features/technologies/services/technologyService";
import { TechnologyActionModal } from "./TechnologyActionModal";

interface AddParameterModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  selectedTech: Technology | null;
  newParam: TechnologyConstraint;
  setNewParam: (param: TechnologyConstraint) => void;
  addingParam: boolean;
}

function AddParameterModal({
  open,
  onClose,
  onSubmit,
  selectedTech,
  newParam,
  setNewParam,
  addingParam,
}: Readonly<AddParameterModalProps>) {
  const { t } = useTranslation();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  // Focus management
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => firstFieldRef.current?.focus());
    }
  }, [open]);

  return (
    <TechnologyActionModal
      open={open}
      onClose={onClose}
      title={t('technologies.paramModal.title')}
      description={t('technologies.paramModal.description', { name: selectedTech?.alias })}
      icon={Plus}
      confirmLabel={t('technologies.addParameter')}
      onConfirm={onSubmit}
      isLoading={addingParam}
      isConfirmDisabled={!newParam.key || !newParam.alias}
      maxWidth="sm:max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="param-key-input" className="block text-sm font-medium text-foreground">
              {t('technologies.form.key')} <span className="text-destructive">*</span>
            </label>
            <input
              id="param-key-input"
              ref={firstFieldRef}
              type="text"
              value={newParam.key}
              onChange={(e) => setNewParam({ ...newParam, key: e.target.value })}
              placeholder={t('technologies.paramModal.keyPlaceholder')}
              className="block w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="param-alias-input" className="block text-sm font-medium text-foreground">
              {t('technologies.form.displayName')} <span className="text-destructive">*</span>
            </label>
            <input
              id="param-alias-input"
              type="text"
              value={newParam.alias}
              onChange={(e) => setNewParam({ ...newParam, alias: e.target.value })}
              placeholder={t('technologies.paramModal.aliasPlaceholder')}
              className="block w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="param-description-input" className="block text-sm font-medium text-foreground">{t('technologies.form.description')}</label>
          <textarea
            id="param-description-input"
            value={newParam.description || ""}
            onChange={(e) => setNewParam({ ...newParam, description: e.target.value })}
            placeholder={t('technologies.paramModal.descriptionPlaceholder')}
            rows={2}
            className="block w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="param-default-input" className="block text-sm font-medium text-foreground">{t('technologies.form.defaultValue')}</label>
            <input
              id="param-default-input"
              type="number"
              step="any"
              value={newParam.default_value ?? ""}
              onChange={(e) => setNewParam({ ...newParam, default_value: e.target.value })}
              placeholder={t('technologies.form.defaultValuePlaceholder')}
              className="block w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="param-unit-input" className="block text-sm font-medium text-foreground">{t('technologies.form.unit')}</label>
            <input
              id="param-unit-input"
              type="text"
              value={newParam.unit || ""}
              onChange={(e) => setNewParam({ ...newParam, unit: e.target.value || null })}
              placeholder={t('technologies.paramModal.unitPlaceholder')}
              className="block w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">{t('technologies.form.range')}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="any"
                value={newParam.min ?? ""}
                onChange={(e) => setNewParam({ ...newParam, min: e.target.value !== "" ? (e.target.value as any) : null })}
                placeholder={t('technologies.form.min')}
                className="w-full px-2 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-muted-foreground">-</span>
              <input
                type="number"
                step="any"
                value={newParam.max ?? ""}
                onChange={(e) => setNewParam({ ...newParam, max: e.target.value !== "" ? (e.target.value as any) : null })}
                placeholder={t('technologies.form.max')}
                className="w-full px-2 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        </div>
      </div>
    </TechnologyActionModal>
  );
}

export default AddParameterModal;

