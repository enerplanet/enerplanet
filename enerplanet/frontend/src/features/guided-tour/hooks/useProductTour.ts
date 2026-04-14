import { useEffect } from 'react';
import { useTourStore } from '@/features/guided-tour/store/tour-store';
import axios from '@/lib/axios';

const USER_COOKIE_NAME = 'user_email';
const SHOW_DELAY_MS = 1500;

export const useProductTour = () => {
  const showTour = useTourStore((s) => s.showTour);
  const tourStep = useTourStore((s) => s.tourStep);
  const setTourStep = useTourStore((s) => s.setTourStep);
  const setShowTour = useTourStore((s) => s.setShowTour);

  const readCookie = (name: string): string | null => {
    if (typeof document === 'undefined') return null;
    const safeName = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const regex = new RegExp(`(^|; )${safeName}=([^;]*)`);
    const match = regex.exec(document.cookie);
    return match ? decodeURIComponent(match[2]) : null;
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const checkAndShowTour = async () => {
      if (cancelled) return;

      const userEmail = readCookie(USER_COOKIE_NAME);
      if (!userEmail) {
        return;
      }

      try {
        const { data } = await axios.get('/settings');

        if (!data.success || !data.data?.privacy_accepted) {
          return;
        }

        if (!data.data.onboarding_completed) {
          return;
        }

        if (data.data.product_tour_completed) {
          return;
        }

        const params = new URLSearchParams(globalThis.location.search);
        if (params.get('showTour') === '1') {
          setShowTour(true);
          return;
        }

        if (!cancelled) {
          timer = setTimeout(() => {
            if (!cancelled) {
              setShowTour(true);
            }
          }, SHOW_DELAY_MS);
        }
      } catch (err) {
        if (import.meta.env.DEV) console.error('Failed to fetch user settings for tour:', err);
      }
    };

    checkAndShowTour();

    const scheduleRecheck = () => setTimeout(checkAndShowTour, 100);
    const handlePrivacyAccepted = () => { scheduleRecheck(); };
    const handleOnboardingCompleted = () => { scheduleRecheck(); };
    globalThis.addEventListener('privacy-accepted', handlePrivacyAccepted);
    globalThis.addEventListener('onboarding-completed', handleOnboardingCompleted);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      globalThis.removeEventListener('privacy-accepted', handlePrivacyAccepted);
      globalThis.removeEventListener('onboarding-completed', handleOnboardingCompleted);
    };
  }, [setShowTour]);

  const completeTour = async () => {
    try {
      await axios.put('/settings/product-tour-completed', {
        completed: true,
      });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to save tour completion status:', error);
    }

    setShowTour(false);
    setTourStep(0);
  };

  const startTour = () => {
    setTourStep(0);
    setShowTour(true);
  };

  const skipTour = () => completeTour();

  const restartAreaSelectTour = async () => {
    globalThis.dispatchEvent(new CustomEvent('restart-area-select-tour'));
  };

  return {
    showTour,
    tourStep,
    setTourStep,
    completeTour,
    startTour,
    skipTour,
    restartAreaSelectTour,
  };
};
