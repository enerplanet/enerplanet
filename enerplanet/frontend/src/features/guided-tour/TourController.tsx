import React, { useState, useEffect, useCallback } from "react";
import ReactJoyride, { CallBackProps, STATUS, Step, EVENTS, ACTIONS } from "react-joyride";
import { buildCurvedPath } from "@/features/guided-tour/utils/tourUtils";
import { useTranslation } from "@spatialhub/i18n";

interface TourControllerProps {
  steps: Step[];
  run: boolean;
  stepIndex: number;
  setStepIndex: (index: number) => void;
  onComplete: () => void;
  onSkip: () => void;
  children?: React.ReactNode;
}

export const TourController: React.FC<TourControllerProps> = ({
  steps,
  run,
  stepIndex,
  setStepIndex,
  onComplete,
  onSkip,
  children,
}) => {
  const [connector, setConnector] = useState<{ path: string; startX: number; startY: number; endX: number; endY: number } | null>(null);
  const { t } = useTranslation();

  const updateConnector = useCallback(() => {
    // Small delay to ensure DOM is updated
    requestAnimationFrame(() => {
      const tooltip = document.querySelector('.react-joyride__tooltip');
      if (!tooltip) {
        setConnector(null);
        return;
      }

      // Find target from current step
      const currentStep = steps[stepIndex];
      if (!currentStep?.target) {
        setConnector(null);
        return;
      }

      let target: Element | null = null;
      if (typeof currentStep.target === 'string') {
        target = document.querySelector(currentStep.target);
      } else if (currentStep.target instanceof Element) {
        target = currentStep.target;
      }

      if (!target || currentStep.target === 'body') {
        setConnector(null);
        return;
      }

      const tooltipRect = tooltip.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const placement = currentStep.placement || 'bottom';

      setConnector(buildCurvedPath(tooltipRect, targetRect, placement));
    });
  }, [stepIndex, steps]);

  // Update connector when step changes or window resizes
  useEffect(() => {
    if (run) {
      // Debounced update to prevent flickering
      let timeoutId: ReturnType<typeof setTimeout>;
      const debouncedUpdate = () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(updateConnector, 50);
      };

      updateConnector();
      window.addEventListener('resize', debouncedUpdate);
      window.addEventListener('scroll', debouncedUpdate, true);

      // Mutation observer - only watch for childList changes, not attributes (which cause flickering on hover)
      const observer = new MutationObserver(debouncedUpdate);
      observer.observe(document.body, { childList: true, subtree: true, attributes: false });

      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', debouncedUpdate);
        window.removeEventListener('scroll', debouncedUpdate, true);
        observer.disconnect();
      };
    } else {
      setConnector(null);
    }
  }, [run, stepIndex, updateConnector]);

  const handleJoyrideCallback = (data: CallBackProps) => {
    const { status, action, index, type } = data;

    // Handle completion states
    const isFinished = status === STATUS.FINISHED || status === STATUS.SKIPPED;
    const isClosed = action === ACTIONS.CLOSE || action === ACTIONS.SKIP;
    
	    if (isFinished || isClosed) {
	      const wasSkipped = action === ACTIONS.SKIP || status === STATUS.SKIPPED;
	      if (wasSkipped) {
	        onSkip();
	      } else {
	        onComplete();
	      }
	      return;
	    }

    // Handle target not found - skip to next available step
	    if (type === EVENTS.TARGET_NOT_FOUND) {
	      const nextIndex = index + 1;
	      if (nextIndex >= steps.length) {
	        onComplete();
	      } else {
	        setStepIndex(nextIndex);
	      }
	      return;
	    }

    // Handle step navigation
    if (type === EVENTS.STEP_AFTER) {
      if (action === ACTIONS.PREV) {
        setStepIndex(Math.max(0, index - 1));
	      } else if (action === ACTIONS.NEXT) {
	        const nextIndex = index + 1;
	        if (nextIndex >= steps.length) {
	          onComplete();
	        } else {
	          setStepIndex(nextIndex);
	        }
	      }
	    }
	  };

  return (
    <>
      {run && connector && (
        <svg
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            pointerEvents: 'none',
            zIndex: 20000,
            willChange: 'auto',
          }}
        >
          <path
            d={connector.path}
            fill="none"
            stroke="#6B7280"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray="6 4"
            style={{ opacity: 0.6 }}
          />
          <circle cx={connector.startX} cy={connector.startY} r="4" fill="#374151" stroke="white" strokeWidth="2" />
          <circle cx={connector.endX} cy={connector.endY} r="5" fill="#374151" stroke="white" strokeWidth="2" />
        </svg>
      )}

      {children}

      <ReactJoyride
        steps={steps}
        run={run}
        stepIndex={stepIndex}
        continuous={true}
        showProgress={false}
        showSkipButton={true}
        disableScrolling={true}
        disableOverlay={false}
        callback={handleJoyrideCallback}
        disableOverlayClose={false}
        hideCloseButton={false}
        spotlightClicks={false}
        disableScrollParentFix={true}
        floaterProps={{
          disableAnimation: false,
        }}
        spotlightPadding={4}
        styles={{
          options: {
            primaryColor: "#374151",
            backgroundColor: "var(--background, #ffffff)",
            textColor: "var(--foreground, #374151)",
            arrowColor: "var(--background, #ffffff)",
            zIndex: 20000,
          },
          tooltip: {
            fontSize: "14px",
            padding: "20px",
            borderRadius: "8px",
            maxWidth: '440px',
            maxHeight: '70vh',
            overflowY: 'auto',
          },
          tooltipContainer: {
            textAlign: "left",
          },
          tooltipTitle: {
            fontSize: "18px",
            fontWeight: "bold",
            marginBottom: "10px",
          },
          tooltipContent: {
            fontSize: "14px",
            lineHeight: "1.5",
          },
          buttonNext: {
            backgroundColor: "#374151",
            color: "white",
            fontSize: "14px",
            padding: "8px 16px",
            borderRadius: "6px",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          },
          buttonBack: {
            color: "#6B7280",
            backgroundColor: "transparent",
            fontSize: "14px",
            padding: "8px 16px",
            border: "1px solid #E5E7EB",
            borderRadius: "6px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          },
          buttonSkip: {
            color: "#9CA3AF",
            backgroundColor: "transparent",
            fontSize: "14px",
            border: "none",
            cursor: "pointer",
            whiteSpace: "nowrap",
          },
          buttonClose: {
            fontSize: "14px",
            color: "#6B7280",
            cursor: "pointer",
          },
          overlay: {
            backgroundColor: "rgba(0, 0, 0, 0.5)",
          },
          spotlight: {
            backgroundColor: "transparent",
          },
          tooltipFooter: {
            display: "flex",
            flexWrap: "nowrap",
            gap: "8px",
            marginTop: "16px",
          },
        }}
        locale={{
          back: t("tour.buttons.back"),
          close: t("tour.buttons.close"),
          last: t("tour.buttons.finish"),
          next: t("tour.buttons.next"),
          skip: t("tour.buttons.skip"),
        }}
      />
    </>
  );
};
