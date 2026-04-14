import { Upload } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { TechnologyActionModal } from "./TechnologyActionModal";

interface ImportTechnologiesModalProps {
  open: boolean;
  onClose: () => void;
  pendingCount: number;
  importAsSystem: boolean;
  setImportAsSystem: (value: boolean) => void;
  importing: boolean;
  onImport: () => void;
}

function ImportTechnologiesModal({
  open,
  onClose,
  pendingCount,
  importAsSystem,
  setImportAsSystem,
  importing,
  onImport,
}: Readonly<ImportTechnologiesModalProps>) {
  const { t } = useTranslation();
  return (
    <TechnologyActionModal
      open={open}
      onClose={onClose}
      title={t('technologies.importModal.title')}
      description={t('technologies.importModal.description', { count: pendingCount })}
      icon={Upload}
      confirmLabel={t('technologies.importJson')}
      onConfirm={onImport}
      isLoading={importing}
      isConfirmDisabled={importing}
      maxWidth="sm:max-w-md"
    >
      <div className="space-y-4">
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-sm text-foreground font-medium mb-1">{t('technologies.importModal.found', { count: pendingCount })}</p>
          <p className="text-xs text-muted-foreground">{t('technologies.importModal.existingSkipped')}</p>
        </div>

        <div className="flex items-center gap-3 p-3 border border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
          <input
            id="import-as-system-checkbox"
            type="checkbox"
            checked={importAsSystem}
            onChange={(e) => setImportAsSystem(e.target.checked)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
          />
          <label htmlFor="import-as-system-checkbox" className="flex-1 cursor-pointer">
            <span className="text-sm font-medium text-foreground">{t('technologies.importModal.importAsSystem')}</span>
            <p className="text-xs text-muted-foreground">
              {t('technologies.importModal.systemDescription')}
            </p>
          </label>
        </div>
      </div>
    </TechnologyActionModal>
  );
}

export default ImportTechnologiesModal;
