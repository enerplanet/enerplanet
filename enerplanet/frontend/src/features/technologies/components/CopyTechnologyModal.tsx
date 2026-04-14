import { Copy } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { Technology } from "@/features/technologies/services/technologyService";
import { TechnologyActionModal } from "./TechnologyActionModal";

interface CopyTechnologyModalProps {
  open: boolean;
  onClose: () => void;
  techToCopy: Technology | null;
  copyKey: string;
  setCopyKey: (value: string) => void;
  copyAlias: string;
  setCopyAlias: (value: string) => void;
  copying: boolean;
  onCopy: () => void;
}

function CopyTechnologyModal({
  open,
  onClose,
  techToCopy,
  copyKey,
  setCopyKey,
  copyAlias,
  setCopyAlias,
  copying,
  onCopy,
}: Readonly<CopyTechnologyModalProps>) {
  const { t } = useTranslation();
  return (
    <TechnologyActionModal
      open={open}
      onClose={onClose}
      title={t('technologies.copyModal.title')}
      description={t('technologies.copyModal.description', { name: techToCopy?.alias })}
      icon={Copy}
      confirmLabel={t('technologies.copyTechnology')}
      onConfirm={onCopy}
      isLoading={copying}
      isConfirmDisabled={!copyKey || !copyAlias}
      maxWidth="sm:max-w-lg"
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="copy-key-input" className="block text-sm font-medium text-foreground">
            {t('technologies.form.key')} <span className="text-destructive">*</span>
          </label>
          <input
            id="copy-key-input"
            type="text"
            value={copyKey}
            onChange={(e) => setCopyKey(e.target.value.toLowerCase().replaceAll(/\s+/g, "_"))}
            placeholder="unique_technology_key"
            className="w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{t('technologies.copyModal.uniqueIdentifier')}</p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="copy-alias-input" className="block text-sm font-medium text-foreground">
            {t('technologies.copyModal.name')} <span className="text-destructive">*</span>
          </label>
          <input
            id="copy-alias-input"
            type="text"
            value={copyAlias}
            onChange={(e) => setCopyAlias(e.target.value)}
            placeholder={t('technologies.form.displayNamePlaceholder')}
            className="w-full px-3 py-2 text-sm border rounded-lg placeholder-muted-foreground text-foreground bg-background border-border focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {techToCopy && (
          <div className="p-3 bg-muted/50 rounded-lg">
            <p className="text-sm text-foreground">
              {t('technologies.copyModal.copyAllParameters', { count: techToCopy.constraints.length, name: techToCopy.alias })}
            </p>
          </div>
        )}
      </div>
    </TechnologyActionModal>
  );
}

export default CopyTechnologyModal;

