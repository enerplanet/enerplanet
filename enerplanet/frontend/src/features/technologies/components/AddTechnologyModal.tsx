import { Plus } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { TechnologyConstraint } from "@/features/technologies/services/technologyService";
import { FormDataConvertible } from "@/hooks/useForm";
import { TechnologyActionModal } from "./TechnologyActionModal";

/** The fields of a new product; its key is generated from type and name. */
export interface ProductFormData {
  type: string;
  alias: string;
  description: string;
  manufacturer: string;
  model: string;
  datasheet_url: string;
}

type ProductForm = {
  data: ProductFormData;
  errors: Partial<Record<keyof ProductFormData, string>>;
  isLoading: boolean;
};

interface AddTechnologyModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  techForm: ProductForm;
  onFieldChange: (key: keyof ProductFormData, value: FormDataConvertible) => void;
  /** The supported technology types, labelled by their default product. */
  typeOptions: { value: string; label: string }[];
  /** The chosen type's parameters; only their values are editable. */
  constraints: TechnologyConstraint[];
  onValueChange: (index: number, value: string) => void;
}

const inputClass =
  "block w-full px-4 py-3 text-sm border rounded-xl placeholder-muted-foreground transition-all duration-200 min-h-[2.875rem] text-foreground bg-background dark:bg-input border-border hover:border-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-muted-foreground";

/** Adds a product of a supported technology type, with that type's parameters. */
function AddTechnologyModal({
  open,
  onClose,
  onSubmit,
  techForm,
  onFieldChange,
  typeOptions,
  constraints,
  onValueChange,
}: Readonly<AddTechnologyModalProps>) {
  const { t } = useTranslation();
  const field = (key: keyof ProductFormData, label: string, required = false, placeholder = "") => (
    <div className="space-y-1.5">
      <label htmlFor={`product-${key}`} className="block text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      <input
        id={`product-${key}`}
        type={key === "datasheet_url" ? "url" : "text"}
        value={techForm.data[key]}
        onChange={(e) => onFieldChange(key, e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
      {techForm.errors[key] && <p className="text-xs text-destructive">{techForm.errors[key]}</p>}
    </div>
  );

  return (
    <TechnologyActionModal
      open={open}
      onClose={onClose}
      title={t('technologies.addModal.title')}
      description={t('technologies.addModal.description')}
      icon={Plus}
      confirmLabel={t('technologies.addModal.confirm')}
      onConfirm={onSubmit}
      isLoading={techForm.isLoading}
      isConfirmDisabled={techForm.isLoading}
      maxWidth="sm:max-w-2xl"
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="product-type" className="block text-sm font-medium text-foreground">
            {t('technologies.form.type')} <span className="text-destructive">*</span>
          </label>
          <select
            id="product-type"
            value={techForm.data.type}
            onChange={(e) => onFieldChange("type", e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>{t('technologies.form.typePlaceholder')}</option>
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {techForm.errors.type && <p className="text-xs text-destructive">{techForm.errors.type}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {field("alias", t('technologies.form.productName'), true, t('technologies.form.productNamePlaceholder'))}
          {field("manufacturer", t('technologies.form.manufacturer'))}
          {field("model", t('technologies.form.model'))}
          {field("datasheet_url", t('technologies.form.datasheet'), false, "https://")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="product-description" className="block text-sm font-medium text-foreground">{t('technologies.form.description')}</label>
          <textarea
            id="product-description"
            value={techForm.data.description}
            onChange={(e) => onFieldChange("description", e.target.value)}
            placeholder={t('technologies.form.descriptionPlaceholder')}
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>

        {constraints.length > 0 && (
          <div>
            <span className="block text-sm font-medium text-foreground mb-1">{t('technologies.parameters')}</span>
            <p className="text-xs text-muted-foreground mb-3">{t('technologies.addModal.parametersHint')}</p>
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {constraints.map((c, index) => (
                <div key={c.key} className="grid grid-cols-[1fr_9rem] items-center gap-3">
                  <label htmlFor={`product-param-${c.key}`} className="text-xs text-foreground">
                    {c.alias}{c.unit ? ` (${c.unit})` : ""}
                    {c.min != null && c.max != null && (
                      <span className="block text-[11px] text-muted-foreground">
                        {t('technologies.addModal.range', { min: c.min, max: c.max })}
                      </span>
                    )}
                  </label>
                  <input
                    id={`product-param-${c.key}`}
                    type="text"
                    inputMode="decimal"
                    value={String(c.default_value ?? "")}
                    onChange={(e) => onValueChange(index, e.target.value)}
                    className="px-2 py-1.5 bg-background border border-border rounded text-xs text-right text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </TechnologyActionModal>
  );
}

export default AddTechnologyModal;
