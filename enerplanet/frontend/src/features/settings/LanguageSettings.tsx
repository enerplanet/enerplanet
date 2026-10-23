import React from 'react';
import { useTranslation, languages, changeLanguage, type LanguageCode } from '@spatialhub/i18n';

/** The interface language, saved for the next visit. */
const LanguageSettings: React.FC = () => {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';

  return (
    <select
      value={currentLang}
      onChange={(e) => changeLanguage(e.target.value as LanguageCode, 'enerplanet_language')}
      aria-label={t('settings.language.title')}
      className="h-9 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {languages.map((language) => (
        <option key={language.code} value={language.code}>
          {language.flag} {language.nativeName}
        </option>
      ))}
    </select>
  );
};

export default LanguageSettings;
