import React from "react";
import { Step } from "react-joyride";
import { useProductTour } from "@/features/guided-tour/hooks/useProductTour";
import { GraduationCap } from "lucide-react";
import { TourController } from "./TourController";
import { useTranslation } from "@spatialhub/i18n";
import {
  TourStepHeader,
  TourStepContent,
  TourTipBox,
  TourDescription,
  TourIcons,
} from "./TourStepComponents";

interface ProductTourProps {
  children?: React.ReactNode;
}

const JOYRIDE_BODY_TARGET = 'body';

const useTourSteps = (): Step[] => {
  const { t } = useTranslation();
  
  return [
    {
      target: JOYRIDE_BODY_TARGET,
      content: (
        <TourStepContent spacing="large">
          <TourStepHeader icon={<span className="text-xl">🎉</span>} title={t('tour.product.welcome.title')} variant="large" />
          <TourDescription variant="muted">{t('tour.product.welcome.description')}</TourDescription>
          <TourTipBox icon={<GraduationCap className="w-4 h-4 text-muted-foreground" />}>
            {t('tour.product.welcome.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "center",
      disableBeacon: true,
      hideFooter: false,
    },
    {
      target: '[data-tour="new-assessment"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.plus("w-4 h-4 text-background")} title={t('tour.product.newAssessment.title')} />
          <TourDescription>
            {t('tour.product.newAssessment.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.info("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.product.newAssessment.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "bottom",
    },
    {
      target: '[data-tour="profile"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.user("w-4 h-4 text-background")} title={t('tour.product.profile.title')} />
          <TourDescription>
            {t('tour.product.profile.description')}
          </TourDescription>
        </TourStepContent>
      ),
      placement: "top",
    },
    {
      target: '[data-tour="navigation"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.grid("w-4 h-4 text-background")} title={t('tour.product.navigation.title')} />
          <TourDescription>
            {t('tour.product.navigation.description')}
          </TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="simulations"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.chart("w-4 h-4 text-background")} title={t('tour.product.simulations.title')} />
          <TourDescription>
            {t('tour.product.simulations.description')}
          </TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="map"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.map("w-4 h-4 text-background")} title={t('tour.product.map.title')} />
          <TourDescription>
            {t('tour.product.map.description')}
          </TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="locations"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.location("w-4 h-4 text-background")} title={t('tour.product.locations.title')} />
          <TourDescription>{t('tour.product.locations.description')}</TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="reports"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.report("w-4 h-4 text-background")} title={t('tour.product.reports.title')} />
          <TourDescription>{t('tour.product.reports.description')}</TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="technologies"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.technology("w-4 h-4 text-background")} title={t('tour.product.technologies.title')} />
          <TourDescription>
            {t('tour.product.technologies.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.info("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.product.technologies.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="layers"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.layers("w-4 h-4 text-background")} title={t('tour.product.layers.title')} />
          <TourDescription>{t('tour.product.layers.description')}</TourDescription>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="documentation"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.book("w-4 h-4 text-background")} title={t('tour.product.documentation.title')} />
          <TourDescription>{t('tour.product.documentation.description')}</TourDescription>
          <TourTipBox icon={TourIcons.externalLink("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.product.documentation.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="feedback"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.feedback("w-4 h-4 text-background")} title={t('tour.product.feedback.title')} />
          <TourDescription>{t('tour.product.feedback.description')}</TourDescription>
        </TourStepContent>
      ),
      placement: "top",
    },
    {
      target: JOYRIDE_BODY_TARGET,
      content: (
        <TourStepContent spacing="large">
          <TourStepHeader icon={<span className="text-xl">🚀</span>} title={t('tour.product.complete.title')} variant="large" />
          <TourDescription variant="muted">{t('tour.product.complete.description')}</TourDescription>
          <TourTipBox icon={TourIcons.arrow("w-4 h-4 text-muted-foreground")}>
            <div>
              <p className="text-xs font-medium text-foreground">{t('tour.product.complete.nextSteps')}</p>
              <p className="text-xs text-muted-foreground">{t('tour.product.complete.nextStepsDescription')}</p>
            </div>
          </TourTipBox>
          <TourTipBox icon={<GraduationCap className="w-4 h-4 text-muted-foreground" />}>
            <div>
              <p className="text-xs font-medium text-foreground">{t('tour.product.complete.restartTour')}</p>
              <p className="text-xs text-muted-foreground">{t('tour.product.complete.restartTourDescription')}</p>
            </div>
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "center",
    },
  ];
};

export const ProductTour: React.FC<ProductTourProps> = ({ children }) => {
  const { showTour, completeTour, tourStep, setTourStep } = useProductTour();
  const tourSteps = useTourSteps();

  return (
    <TourController
      steps={tourSteps}
      run={showTour}
      stepIndex={tourStep}
      setStepIndex={setTourStep}
      onComplete={completeTour}
      onSkip={completeTour}
    >
      {children}
    </TourController>
  );
};