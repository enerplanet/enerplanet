import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '@/configuration/app';
import { useAuthStore } from '@/store/auth-store';

interface BrowserNotification {
  id: number;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  read: boolean;
  created_at: string;
}

interface InAppNotification {
  id: number;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  timestamp: Date;
}

const NOTIFICATION_ICON = '/images/logo/enerplanet-logo.png';
const SUCCESS_ICON = '/images/success-icon.png';
const ERROR_ICON = '/images/error-icon.png';
const BADGE_ICON = '/images/badge.png';
const DEFAULT_TAG = 'spatialhub-notification';

const hasNotificationSupport = (): boolean =>
  typeof globalThis !== 'undefined' && 'Notification' in globalThis;

const focusWindow = (): void => {
  const maybeWindow = globalThis as typeof globalThis & { focus?: () => void };
  maybeWindow.focus?.();
};

const buildStreamUrl = (): string => {
  const base = config.api.baseUrl || '/api';
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${normalizedBase}/notifications/stream`;
};

export const useBrowserNotifications = (enabled: boolean, useInAppPanel = true) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isConnected, setIsConnected] = useState(false);
  const [currentNotification, setCurrentNotification] = useState<InAppNotification | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!hasNotificationSupport()) {
      if (import.meta.env.DEV) console.warn('Browser does not support notifications');
      return false;
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error requesting notification permission:', error);
      return false;
    }
  }, []);

  const showNotification = useCallback((title: string, options?: NotificationOptions) => {
    if (!hasNotificationSupport()) {
      if (import.meta.env.DEV) console.warn('Browser does not support notifications');
      return;
    }

    if (Notification.permission !== 'granted') {
      if (import.meta.env.DEV) console.warn('Notification permission not granted');
      return;
    }

    try {
      const notification = new Notification(title, {
        icon: NOTIFICATION_ICON,
        badge: BADGE_ICON,
        tag: DEFAULT_TAG,
        requireInteraction: false,
        ...options,
      });

      const autoClose = setTimeout(() => notification.close(), 10000);

      notification.onclick = () => {
        focusWindow();
        notification.close();
      };

      notification.onclose = () => clearTimeout(autoClose);

      return notification;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error showing notification:', error);
      return undefined;
    }
  }, []);

  const handleNotificationEvent = useCallback((event: MessageEvent) => {
    try {
      const notification = JSON.parse(event.data) as BrowserNotification;

      if (useInAppPanel) {
        setCurrentNotification({
          id: notification.id,
          title: notification.title,
          message: notification.message,
          type: notification.type,
          timestamp: new Date(),
        });
        return;
      }

      if (permission !== 'granted') {
        return;
      }

      const notifOptions: NotificationOptions = {
        body: notification.message,
        icon: NOTIFICATION_ICON,
        tag: `notification-${notification.id}`,
      };

      if (notification.type === 'success') {
        notifOptions.icon = SUCCESS_ICON;
      } else if (notification.type === 'error') {
        notifOptions.icon = ERROR_ICON;
      }

      showNotification(notification.title, notifOptions);
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error parsing notification:', err);
    }
  }, [permission, showNotification, useInAppPanel]);

  const closeEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.removeEventListener('notification', handleNotificationEvent as EventListener);
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, [handleNotificationEvent]);

  const connectSSE = useCallback(() => {
    // Connect if enabled, regardless of notification permission when using in-app panel
    if (!enabled) {
      return;
    }
    
    // Don't connect if user is not authenticated
    const user = useAuthStore.getState().user;
    if (!user) {
      return;
    }
    
    // Only require permission when not using in-app panel
    if (!useInAppPanel && permission !== 'granted') {
      return;
    }

    try {
      const streamUrl = buildStreamUrl();
      const eventSource = new EventSource(streamUrl, {
        withCredentials: true,
      });

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.addEventListener('notification', handleNotificationEvent as EventListener);

      eventSource.onerror = () => {
        setIsConnected(false);
        eventSource.removeEventListener('notification', handleNotificationEvent as EventListener);
        eventSource.close();
        clearReconnectTimeout();
        
        // Only reconnect if user is still authenticated
        const user = useAuthStore.getState().user;
        if (!user) {
          return;
        }
        
        reconnectTimeoutRef.current = setTimeout(() => {
          // Double-check user is still authenticated before reconnecting
          const currentUser = useAuthStore.getState().user;
          if (currentUser) {
            connectSSE();
          }
        }, 5000);
      };

      eventSourceRef.current = eventSource;
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error connecting to SSE:', error);
    }
  }, [enabled, permission, useInAppPanel, handleNotificationEvent, clearReconnectTimeout]);

  useEffect(() => {
    // Close if disabled
    if (!enabled) {
      closeEventSource();
      clearReconnectTimeout();
      return;
    }
    
    // Close if not using in-app panel and no permission
    if (!useInAppPanel && permission !== 'granted') {
      closeEventSource();
      clearReconnectTimeout();
      return;
    }

    connectSSE();

    return () => {
      closeEventSource();
      clearReconnectTimeout();
    };
  }, [enabled, permission, useInAppPanel, connectSSE, closeEventSource, clearReconnectTimeout]);

  useEffect(() => {
    if (hasNotificationSupport()) {
      setPermission(Notification.permission);
    }
  }, []);

  const clearNotification = useCallback(() => {
    setCurrentNotification(null);
  }, []);

  return {
    permission,
    requestPermission,
    showNotification,
    isConnected,
    isSupported: hasNotificationSupport(),
    currentNotification,
    clearNotification,
  };
};
