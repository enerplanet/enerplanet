import { useState, useEffect, useCallback, useRef } from "react";
import { useAuthStore } from "@/store/auth-store";
import { useNavigate } from "react-router-dom";
import { closeNotificationStream } from "@/features/notifications/hooks/useNotificationsQuery";
import { keepSessionAlive } from "@/services/authService";

interface UseSessionTimerOptions {
  warningThreshold?: number; // Minutes before showing warning (default: 5)
}

/**
 * useSessionTimer manages the global session expiration logic.
 */
export const useSessionTimer = ({ warningThreshold = 5 }: UseSessionTimerOptions = {}) => {
  const { user, logoutSessionExpired, sessionTimeout } = useAuthStore();
  const navigate = useNavigate();

  // We store the expiration timestamp in a ref to avoid triggering React updates
  // when the timer naturally counts down.
  const expiresAtRef = useRef<number | null>(null);
  const lastRefreshRef = useRef<number>(Date.now());
  const [isWarning, setIsWarning] = useState(false);

  const handleTimeout = useCallback(() => {
    // Guard: prevent double-firing from multiple timer instances
    const state = useAuthStore.getState();
    if (state.isSessionExpired || !state.user) return;
    expiresAtRef.current = null;
    closeNotificationStream();
    logoutSessionExpired();
    navigate("/login");
  }, [logoutSessionExpired, navigate]);

  const resetTimer = useCallback(() => {
    if (sessionTimeout && user) {
      expiresAtRef.current = Date.now() + sessionTimeout * 60 * 1000;
      setIsWarning(false);

      // Ping backend every 5 minutes to keep the server-side session alive.
      const now = Date.now();
      if (now - lastRefreshRef.current > 5 * 60 * 1000) {
        lastRefreshRef.current = now;
        void keepSessionAlive().catch((err: any) => {
          const status = err?.response?.status;
          if (status === 401 || status === 403) {
            handleTimeout();
          }
        });
      }
    }
  }, [sessionTimeout, user, handleTimeout]);

  // Initial initialization
  useEffect(() => {
    if (sessionTimeout && user) {
      if (!expiresAtRef.current) {
        expiresAtRef.current = Date.now() + sessionTimeout * 60 * 1000;
      }
    } else {
      expiresAtRef.current = null;
    }
  }, [sessionTimeout, user]);

  // Global Check Loop: runs relatively infrequently (e.g. every 5 seconds)
  // just to see if we've hit the warning threshold or expiration.
  // This does NOT update state unless a threshold is crossed.
  useEffect(() => {
    if (!user || !sessionTimeout) return;

    const checkInterval = setInterval(() => {
      if (!expiresAtRef.current) return;

      const remainingMs = expiresAtRef.current - Date.now();
      const remainingSecs = Math.floor(remainingMs / 1000);

      // Timeout reached
      if (remainingSecs <= 0) {
        clearInterval(checkInterval);
        handleTimeout();
        return;
      }

      // Warning threshold reached
      if (remainingSecs <= warningThreshold * 60 && remainingSecs > 0) {
        setIsWarning(prev => {
          if (!prev) return true; // Only trigger render if changing from false to true
          return prev;
        });
      } else {
        setIsWarning(prev => {
          if (prev) return false;
          return prev;
        });
      }
    }, 5000); // Check every 5 seconds instead of every 1 second

    return () => clearInterval(checkInterval);
  }, [user, warningThreshold, sessionTimeout, handleTimeout]);

  // Reset timer on user activity
  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetTimer();

    for (const event of events) {
      globalThis.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of events) {
        globalThis.removeEventListener(event, handleActivity);
      }
    };
  }, [user, resetTimer]);

  // Periodic keep-alive for inactive tabs
  useEffect(() => {
    if (!user || !sessionTimeout) return;

    const KEEP_ALIVE_MS = 4 * 60 * 1000; // 4 minutes

    const id = setInterval(() => {
      if (!expiresAtRef.current) return;
      const remainingMs = expiresAtRef.current - Date.now();
      if (remainingMs <= 0) return; // let the main timer handle expiry

      const now = Date.now();
      if (now - lastRefreshRef.current >= KEEP_ALIVE_MS) {
        lastRefreshRef.current = now;
        void keepSessionAlive().catch(() => {/* axios interceptor handles 401 */});
      }
    }, KEEP_ALIVE_MS);

    return () => clearInterval(id);
  }, [user, sessionTimeout]);

  // Visibility change
  useEffect(() => {
    if (!user || !sessionTimeout) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (expiresAtRef.current && expiresAtRef.current - Date.now() > 0) {
          resetTimer();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user, sessionTimeout, resetTimer]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getRemainingSeconds = useCallback((): number => {
    if (!expiresAtRef.current) return 0;
    return Math.max(0, Math.floor((expiresAtRef.current - Date.now()) / 1000));
  }, []);

  return {
    isWarning,
    resetTimer,
    formatTime,
    getRemainingSeconds,
    isActive: !!user && !!sessionTimeout,
  };
};

