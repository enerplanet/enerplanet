import React, { useState, useEffect } from "react";
import { Step } from "react-joyride";
import { TourController } from "./TourController";
import { useTranslation } from "@spatialhub/i18n";
import {
  TourStepHeader,
  TourStepContent,
  TourTipBox,
  TourDescription,
  TourIcons,
} from "./TourStepComponents";

interface AreaSelectTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

const useAreaSelectSteps = (): Step[] => {
  const { t } = useTranslation();
  
  return [
    {
      target: "body",
      content: (
        <TourStepContent spacing="large">
          <TourStepHeader icon={TourIcons.map("w-5 h-5 text-foreground")} title={t('tour.areaSelect.welcome.title')} variant="large" />
          <TourDescription variant="muted">
            {t('tour.areaSelect.welcome.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.info("w-4 h-4 text-muted-foreground")}>
            {t('tour.areaSelect.welcome.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "center",
      disableBeacon: true,
    },
    {
      target: '[data-tour="model-name"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.edit("w-4 h-4 text-background")} title={t('tour.areaSelect.modelName.title')} />
          <TourDescription>
            {t('tour.areaSelect.modelName.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.pencil("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.modelName.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "left",
    },
    {
      target: '[data-tour="date-range"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.calendar("w-4 h-4 text-background")} title={t('tour.areaSelect.dateRange.title')} />
          <TourDescription>
            {t('tour.areaSelect.dateRange.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.lightning("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.dateRange.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "left",
    },
    {
      target: '[data-tour="resolution"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.clock("w-4 h-4 text-background")} title={t('tour.areaSelect.resolution.title')} />
          <TourDescription>
            {t('tour.areaSelect.resolution.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.info("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.resolution.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "left",
    },
    {
      target: '[data-tour="technologies-parameters"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.technology("w-4 h-4 text-background")} title={t('tour.areaSelect.technologies.title')} />
          <TourDescription>
            {t('tour.areaSelect.technologies.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.checkCircle("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.technologies.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "left",
    },
    {
      target: '[data-tour="map-container"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.map("w-4 h-4 text-background")} title={t('tour.areaSelect.mapContainer.title')} />
          <TourDescription>
            {t('tour.areaSelect.mapContainer.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.search("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.mapContainer.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "center",
      spotlightClicks: true,
      disableScrolling: false,
    },
    {
      target: '[data-tour="municipality-search"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.search("w-4 h-4 text-background")} title={t('tour.areaSelect.search.title')} />
          <TourDescription>
            {t('tour.areaSelect.search.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.search("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.search.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "right",
    },
    {
      target: '[data-tour="save-button"]',
      content: (
        <TourStepContent>
          <TourStepHeader icon={TourIcons.save("w-4 h-4 text-background")} title={t('tour.areaSelect.save.title')} />
          <TourDescription>
            {t('tour.areaSelect.save.description')}
          </TourDescription>
          <TourTipBox icon={TourIcons.checkCircle("w-4 h-4 text-muted-foreground")} variant="compact">
            {t('tour.areaSelect.save.tip')}
          </TourTipBox>
        </TourStepContent>
      ),
      placement: "top",
    },
  ];
};

export const AreaSelectTour: React.FC<AreaSelectTourProps> = ({ isOpen, onComplete, onSkip }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const areaSelectSteps = useAreaSelectSteps();

  // Reset step index when tour opens
  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  // Scroll to map for first step
  useEffect(() => {
    if (isOpen && stepIndex === 1) {
      setTimeout(() => {
        const mapContainer = document.querySelector('[data-tour="map-container"]');
        if (mapContainer) {
          mapContainer.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }, 100);
    }
  }, [isOpen, stepIndex]);

  return (
    <TourController
      steps={areaSelectSteps}
      run={isOpen}
      stepIndex={stepIndex}
      setStepIndex={setStepIndex}
      onComplete={onComplete}
      onSkip={onSkip}
    />
  );
};