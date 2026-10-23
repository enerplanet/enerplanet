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
      className="w-full px-4 py-2.5 border border-border rounded-lg bg-background dark:bg-input text-foreground focus:ring-2 focus:ring-ring focus:border-transparent transition-colors shadow-sm"
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
