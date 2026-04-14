import { ComponentType } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { TechnologyConstraint } from "@/features/technologies/services/technologyService";
import { FormDataConvertible } from "@/hooks/useForm";
import { TechnologyActionModal } from "./TechnologyActionModal";

type TechnologyForm<FormData> = {
  data: FormData;
  errors: Partial<Record<keyof FormData, string>>;
  isLoading: boolean;
  setData: (key: keyof FormData, value: FormDataConvertible) => void;
};

interface AddTechnologyModalProps<FormData extends { key: string; alias: string; icon: string; description: string }> {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  techForm: TechnologyForm<FormData>;
  onFieldChange: (key: keyof FormData, value: FormDataConvertible) => void;
  iconOptions: { value: string; label: string; icon: ComponentType<{ className?: string }> }[];
  newTechConstraints: TechnologyConstraint[];
  addConstraint: () => void;
  removeConstraint: (index: number) => void;
  updateConstraint: (index: number, field: keyof TechnologyConstraint, value: string | number | null) => void;
}

function AddTechnologyModal<FormData extends { key: string; alias: string; icon: string; description: string }>({
  open,
  onClose,
  onSubmit,
  techForm,
  onFieldChange,
  iconOptions,
  newTechConstraints,
  addConstraint,
  removeConstraint,
  updateConstraint,
}: Readonly<AddTechnologyModalProps<FormData>>) {
  const { t } = useTranslation();
  return (
    <TechnologyActionModal
      open={open}
      onClose={onClose}
      title={t('technologies.addModal.title')}
      description={t('technologies.addModal.description')}
      icon={Plus}
      confirmLabel={t('technologies.addTechnology')}
      onConfirm={onSubmit}
      isLoading={techForm.isLoading}
      isConfirmDisabled={techForm.isLoading}
      maxWidth="sm:max-w-2xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label htmlFor="tech-key-input" className="block text-sm font-medium text-foreground">
              {t('technologies.form.key')} <span className="text-destructive">*</span>
            </label>
            <input
              id="tech-key-input"
              type="text"
              value={techForm.data.key}
              onChange={(e) => onFieldChange("key", e.target.value)}
              placeholder={t('technologies.form.keyPlaceholder')}
              className="block w-full pl-4 pr-4 py-3 text-sm border rounded-xl placeholder-muted-foreground transition-all duration-200 min-h-[2.875rem] text-foreground bg-background dark:bg-input border-border hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-muted-foreground"
            />
            {techForm.errors.key && <p className="text-xs text-destructive">{techForm.errors.key}</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="tech-alias-input" className="block text-sm font-medium text-foreground">
              {t('technologies.form.displayName')} <span className="text-destructive">*</span>
            </label>
            <input
              id="tech-alias-input"
              type="text"
              value={techForm.data.alias}
              onChange={(e) => onFieldChange("alias", e.target.value)}
              placeholder={t('technologies.form.displayNamePlaceholder')}
              className="block w-full pl-4 pr-4 py-3 text-sm border rounded-xl placeholder-muted-foreground transition-all duration-200 min-h-[2.875rem] text-foreground bg-background dark:bg-input border-border hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-muted-foreground"
            />
            {techForm.errors.alias && <p className="text-xs text-destructive">{techForm.errors.alias}</p>}
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="tech-description-input" className="block text-sm font-medium text-foreground">{t('technologies.form.description')}</label>
          <textarea
            id="tech-description-input"
            value={techForm.data.description}
            onChange={(e) => onFieldChange("description", e.target.value)}
            placeholder={t('technologies.form.descriptionPlaceholder')}
            rows={2}
            className="block w-full pl-4 pr-4 py-3 text-sm border rounded-xl placeholder-muted-foreground transition-all duration-200 text-foreground bg-background dark:bg-input border-border hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-muted-foreground resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-foreground">{t('technologies.form.icon')}</span>
          <div className="flex flex-wrap gap-2">
            {iconOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onFieldChange("icon", opt.value)}
                className={`p-2 rounded-lg border transition-colors ${
                  techForm.data.icon === opt.value ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                }`}
              >
                <opt.icon className="w-5 h-5 text-foreground" />
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-foreground">{t('technologies.form.parametersOptional')}</span>
            <button type="button" onClick={addConstraint} className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
              <Plus className="w-3 h-3" />
              {t('technologies.addParameter')}
            </button>
          </div>

          <div className="space-y-3 max-h-48 overflow-y-auto">
            {newTechConstraints.map((constraint, index) => (
              <div key={`constraint-${constraint.key || index}`} className="p-3 bg-muted/50 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('technologies.form.parameter')} {index + 1}</span>
                  {newTechConstraints.length > 1 && (
                    <button type="button" onClick={() => removeConstraint(index)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">
                      <X className="w-3 h-3 text-red-500" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={constraint.key}
                    onChange={(e) => updateConstraint(index, "key", e.target.value)}
                    placeholder={t('technologies.form.keyFieldPlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={constraint.alias}
                    onChange={(e) => updateConstraint(index, "alias", e.target.value)}
                    placeholder={t('technologies.form.aliasFieldPlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="number"
                    step="any"
                    value={constraint.default_value}
                    onChange={(e) => updateConstraint(index, "default_value", e.target.value)}
                    placeholder={t('technologies.form.defaultValuePlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="text"
                    value={constraint.unit || ""}
                    onChange={(e) => updateConstraint(index, "unit", e.target.value || null)}
                    placeholder={t('technologies.form.unitPlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="number"
                    step="any"
                    value={constraint.min ?? ""}
                    onChange={(e) => updateConstraint(index, "min", e.target.value !== "" ? e.target.value : null)}
                    placeholder={t('technologies.form.minPlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <input
                    type="number"
                    step="any"
                    value={constraint.max ?? ""}
                    onChange={(e) => updateConstraint(index, "max", e.target.value !== "" ? e.target.value : null)}
                    placeholder={t('technologies.form.maxPlaceholder')}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TechnologyActionModal>
  );
}

export default AddTechnologyModal;

