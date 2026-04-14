import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation, languages, changeLanguage, type LanguageCode } from '@spatialhub/i18n';

const LanguageSettings: React.FC = () => {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';

  const handleLanguageChange = async (code: LanguageCode) => {
    await changeLanguage(code, 'enerplanet_language');
  };

  const getLanguageButtonClass = (isSelected: boolean) => {
    if (isSelected) {
      return 'border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-900';
    }
    return 'border-gray-200 dark:border-gray-700 bg-background hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800';
  };

  return (
    <div className="space-y-1.5">
      {languages.map((language) => (
        <button
          key={language.code}
          onClick={() => handleLanguageChange(language.code)}
          className={`
            w-full px-2.5 py-1.5 rounded-md border transition-all duration-200 flex items-center justify-between text-foreground
            ${getLanguageButtonClass(currentLang === language.code)}
          `}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">{language.flag}</span>
            <div className="text-left">
              <div className="font-medium text-xs text-gray-900 dark:text-gray-100">
                {language.nativeName}
              </div>
            </div>
          </div>
          {currentLang === language.code && (
            <div className="w-4 h-4 rounded-full bg-gray-900 dark:bg-gray-100 flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-white dark:text-gray-900" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
};

export default LanguageSettings;
