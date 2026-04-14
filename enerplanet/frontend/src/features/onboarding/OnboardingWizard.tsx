import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, Button } from '@spatialhub/ui';
import { ChevronRight, ChevronLeft, Check, Globe, Cloud, Map, Bell } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import WeatherSettings from '@/features/weather/WeatherSettings';
import MapLocationSettings from '@/features/settings/MapLocationSettings';
import NotificationSettings from '@/features/settings/NotificationSettings';
import axios from '@/lib/axios';

interface OnboardingWizardProps {
  isOpen: boolean;
  onComplete: () => void;
}

const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ isOpen, onComplete }) => {
  const { i18n } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [langKey, setLangKey] = useState(0);

  // Called when language is changed in LanguageStep
  const handleLanguageChanged = () => {
    setLangKey(k => k + 1);
  };

  const getStepClassName = (index: number) => {
    if (index < currentStep) {
      return 'bg-gray-800 dark:bg-gray-600 text-white shadow-md';
    }
    if (index === currentStep) {
      return 'bg-gradient-to-br from-gray-800 to-black dark:from-gray-600 dark:to-gray-800 text-white ring-2 ring-gray-400 dark:ring-gray-500 shadow-lg scale-105';
    }
    return 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400';
  };

  const getStepContent = (index: number) => {
    if (index < currentStep) {
      return <Check className="w-3.5 h-3.5" />;
    }
    return index + 1;
  };

  // Fade-in effect when dialog opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setIsVisible(true);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // Step configuration - components are rendered separately to ensure proper re-rendering on language change
  const stepConfig = useMemo(() => [
    {
      id: 'welcome',
      titleKey: 'onboarding.welcome.title',
      descriptionKey: 'onboarding.welcome.description',
      icon: <Globe className="w-5 h-5 text-foreground" />,
    },
    {
      id: 'language',
      titleKey: 'onboarding.language.title',
      descriptionKey: 'onboarding.language.description',
      icon: <Globe className="w-5 h-5 text-foreground" />,
    },
    {
      id: 'weather',
      titleKey: 'onboarding.weather.title',
      descriptionKey: 'onboarding.weather.description',
      icon: <Cloud className="w-5 h-5 text-foreground" />,
    },
    {
      id: 'map',
      titleKey: 'onboarding.map.title',
      descriptionKey: 'onboarding.map.description',
      icon: <Map className="w-5 h-5 text-foreground" />,
    },
    {
      id: 'notifications',
      titleKey: 'onboarding.notifications.title',
      descriptionKey: 'onboarding.notifications.description',
      icon: <Bell className="w-5 h-5 text-foreground" />,
    },
  ], []);

  // Render step component based on current step - this ensures fresh rendering on language change
  const renderStepComponent = (stepId: string) => {
    switch (stepId) {
      case 'welcome':
        return <WelcomeStep key={`${langKey}-${i18n.language}`} />;
      case 'language':
        return <LanguageStep onLanguageChange={handleLanguageChanged} />;
      case 'weather':
        return <div className="p-4"><WeatherSettings /></div>;
      case 'map':
        return <div className="p-4"><MapLocationSettings /></div>;
      case 'notifications':
        return <div className="p-4"><NotificationSettings /></div>;
      default:
        return null;
    }
  };

  const steps = useMemo(() => stepConfig.map(step => ({
    ...step,
    title: i18n.getFixedT(i18n.language)(step.titleKey),
    description: i18n.getFixedT(i18n.language)(step.descriptionKey),
  })), [i18n, i18n.language, langKey, stepConfig]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      // Mark onboarding as completed in the backend
      await axios.patch('/settings', { onboarding_completed: true });
      onComplete();

      // Dispatch event to trigger product tour check
      globalThis.dispatchEvent(new CustomEvent('onboarding-completed'));
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error completing onboarding:', error);
      // Still complete the onboarding even if the API call fails
      onComplete();

      // Still dispatch event even if save fails
      globalThis.dispatchEvent(new CustomEvent('onboarding-completed'));
    } finally {
      setIsCompleting(false);
    }
  };

  const handleSkip = () => {
    // Allow user to skip onboarding
    handleComplete();
  };

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleSkip(); }}>
      <DialogContent 
          className={`!w-[420px] !max-w-[420px] max-h-[85vh] overflow-y-auto p-0 transition-opacity duration-500 ease-in-out ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-5 pt-4 pb-2 bg-background">
          <div className="flex items-center gap-2 mb-1">
            {currentStepData.icon}
            <DialogTitle className="text-lg font-semibold text-foreground">{currentStepData.title}</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {currentStepData.description}
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-center gap-1.5 px-5 py-2 bg-background">
          {steps.map((step, index) => (
            <React.Fragment key={step.id}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300 ease-in-out ${getStepClassName(index)}`}
              >
                {getStepContent(index)}
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`h-0.5 w-8 rounded transition-all duration-300 ease-in-out ${
                    index < currentStep ? 'bg-primary' : 'bg-muted'
                  }`}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step Content - key forces re-render on language change */}
        <div key={`${currentStepData.id}-${langKey}-${i18n.language}`} className="border-t border-b border-border bg-background overflow-hidden transition-all duration-300 ease-in-out">
          {renderStepComponent(currentStepData.id)}
        </div>

        {/* Navigation Buttons */}
        <div className="flex justify-between items-center px-5 py-3 bg-background">
          <Button
            onClick={handlePrevious}
            disabled={currentStep === 0}
            variant="outline"
            size="sm"
            className="flex items-center gap-1 text-xs border-border hover:bg-muted transition-all duration-200 disabled:opacity-50"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {i18n.getFixedT(i18n.language)('onboarding.navigation.previous')}
          </Button>

          <div className="text-xs text-muted-foreground font-medium">
            {currentStep + 1} / {steps.length}
          </div>

          <Button
            onClick={handleNext}
            disabled={isCompleting}
            size="sm"
            className="flex items-center gap-1 text-xs bg-gradient-to-br from-gray-800 to-black dark:from-gray-600 dark:to-gray-800 hover:from-gray-700 hover:to-gray-900 text-white transition-all duration-200 shadow-md hover:shadow-lg"
          >
            {isLastStep ? (
              <>
                {isCompleting ? i18n.getFixedT(i18n.language)('onboarding.navigation.completing') : i18n.getFixedT(i18n.language)('onboarding.navigation.complete')}
                <Check className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                {i18n.getFixedT(i18n.language)('onboarding.navigation.next')}
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Welcome Step Component
const WelcomeStep: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div className="p-6 bg-background">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-gradient-to-br from-gray-800 to-black dark:from-gray-600 dark:to-gray-800 rounded-full flex items-center justify-center shadow-lg">
            <span className="text-3xl">👋</span>
          </div>
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold text-foreground">
            {t('onboarding.welcome.greeting')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('onboarding.welcome.intro')}
          </p>
        </div>
        <div className="pt-2 space-y-2">
          <div className="flex items-start gap-2 text-left">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.welcome.step1')}
            </p>
          </div>
          <div className="flex items-start gap-2 text-left">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.welcome.step2')}
            </p>
          </div>
          <div className="flex items-start gap-2 text-left">
            <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Check className="w-3 h-3 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('onboarding.welcome.step3')}
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground pt-2">
          {t('onboarding.welcome.timeNote')} ⏱️
        </p>
      </div>
    </div>
  );
};

// Language Selection Step Component
interface LanguageStepProps {
  onLanguageChange?: () => void;
}

const LanguageStep: React.FC<LanguageStepProps> = ({ onLanguageChange }) => {
  const { i18n } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || 'en');

  const handleLanguageChange = async (code: string) => {
    setSelectedLanguage(code);
    try {
      // Change i18n language immediately for instant UI update
      await i18n.changeLanguage(code);
      localStorage.setItem('app_language', code);
      // Notify parent to re-render
      onLanguageChange?.();
      // Save language preference to backend
      await axios.patch('/settings', { language: code });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error saving language:', error);
    }
  };

  const languages = [
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
    { code: 'fr', name: 'Français', flag: '🇫🇷' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'it', name: 'Italiano', flag: '🇮🇹' },
    { code: 'nl', name: 'Nederlands', flag: '🇳🇱' },
    { code: 'pl', name: 'Polski', flag: '🇵🇱' },
    { code: 'cs', name: 'Čeština', flag: '🇨🇿' },
  ];

  return (
    <div className="p-4 bg-background">
      <div className="grid grid-cols-2 gap-2">
        {languages.map((language) => (
          <button
            key={language.code}
            onClick={() => handleLanguageChange(language.code)}
            className={`w-full p-2.5 rounded-lg border-2 transition-all duration-200 ease-in-out flex items-center gap-2.5 ${
              selectedLanguage === language.code
                ? 'border-primary bg-primary/10'
                : 'bg-background border-border hover:border-primary hover:bg-muted'
            }`}
          >
            <span className="text-xl">{language.flag}</span>
            <div className="text-left">
              <div className="font-medium text-sm text-foreground">
                {language.name}
              </div>
            </div>
            {selectedLanguage === language.code && (
              <div className="ml-auto w-5 h-5 rounded-full bg-gradient-to-br from-gray-800 to-black dark:from-gray-600 dark:to-gray-800 flex items-center justify-center shadow-md">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default OnboardingWizard;
