import React from "react";
import { Shield, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@spatialhub/i18n";

interface PrivacyBannerProps {
  onClick: () => void;
  hasAccepted: boolean;
}

export const PrivacyBanner: React.FC<PrivacyBannerProps> = ({
  onClick,
  hasAccepted,
}) => {
  const { t } = useTranslation();
  
  return (
    <div className="fixed bottom-4 left-[72px] z-50 animate-in slide-in-from-bottom-4 fade-in duration-700">
      <button
        onClick={onClick}
        aria-pressed={hasAccepted}
        aria-label={hasAccepted ? t('privacy.openSettings') : t('privacy.acceptTerms')}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 transform hover:scale-105",
          "bg-gray-700 text-white hover:bg-gray-600 border border-gray-600",
          !hasAccepted && "animate-pulse"
        )}
      >
        {hasAccepted ? (
          <>
            <Shield className="w-4 h-4" aria-hidden="true" />
            <span>{t('privacy.dataAndPrivacy')}</span>
          </>
        ) : (
          <>
            <Info className="w-4 h-4" aria-hidden="true" />
            <span>{t('privacy.acceptTerms')}</span>
          </>
        )}
      </button>
    </div>
  );
};
