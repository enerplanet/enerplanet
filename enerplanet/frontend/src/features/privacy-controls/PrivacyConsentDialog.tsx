import React from "react";
import { Shield, ExternalLink } from "lucide-react";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@spatialhub/i18n";

interface PrivacyConsentDialogProps {
  isOpen: boolean;
  onAccept: () => void;
  onDeny: () => void;
  onClose: () => void;
}

export const PrivacyConsentDialog: React.FC<PrivacyConsentDialogProps> = ({
  isOpen,
  onAccept,
  onDeny,
  onClose,
}) => {
  const { t } = useTranslation();
  
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end justify-start p-6 z-50 animate-in fade-in duration-300"
      aria-modal="true"
      aria-labelledby="privacy-dialog-title"
    >
      <dialog
        open
        className="bg-background/95 dark:bg-card/95 backdrop-blur-2xl border-border rounded-lg shadow-xl max-w-md w-full mb-16 ml-[72px] max-h-[80vh] flex flex-col border animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-muted rounded-xl flex items-center justify-center shadow-lg">
              <Shield className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 id="privacy-dialog-title" className="text-lg font-semibold text-foreground">
              {t('privacy.dialogTitle')}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <IconX className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm text-muted-foreground overflow-y-auto">
          <p>
            {t('privacy.cartoDescription')}
          </p>

          <p>
            <strong>{t('privacy.sharedWithCarto')}</strong>
          </p>

          <ul className="list-disc list-inside space-y-1 ml-4">
            <li>{t('privacy.ipAddress')}</li>
            <li>{t('privacy.browserDeviceType')}</li>
            <li>{t('privacy.timeOfRequest')}</li>
          </ul>

          <p>
            {t('privacy.localStorageDescription')}
          </p>

          <p>
            {t('privacy.reviewPolicies')}{" "}
            <a
              href="https://carto.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground underline inline-flex items-center gap-1"
            >
              {t('privacy.cartoPolicy')} <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>{" "}
            |{" "}
            <a
              href="https://osmfoundation.org/wiki/Privacy_Policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground underline inline-flex items-center gap-1"
            >
              {t('privacy.osmfPolicy')} <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>{" "}
            |{" "}
            <button
              type="button"
              onClick={() => window.open('/privacy', '_blank', 'noopener,noreferrer')}
              className="text-muted-foreground hover:text-foreground underline inline-flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0 font-inherit"
            >
              {t('privacy.firePolicy')} <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </button>
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-3 p-6 border-t border-border">
          <button
            onClick={onDeny}
            className={cn(
              "flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors",
              "text-foreground bg-muted hover:bg-muted/80"
            )}
          >
            {t('privacy.deny')}
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 transition-colors"
          >
            {t('privacy.accept')}
          </button>
        </div>
      </dialog>
    </div>
  );
};
