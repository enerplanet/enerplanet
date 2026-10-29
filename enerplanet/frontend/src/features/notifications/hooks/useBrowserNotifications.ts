import { useEffect, useState, useCallback } from 'react';
import { subscribeNotifications } from '@/features/notifications/notificationStream';

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

export const useBrowserNotifications = (enabled: boolean, useInAppPanel = true) => {
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [currentNotification, setCurrentNotification] = useState<InAppNotification | null>(null);

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

  useEffect(() => {
    if (!enabled) return;
    // Without the in-app panel, events are only shown as browser notifications.
    if (!useInAppPanel && permission !== 'granted') return;
    return subscribeNotifications(handleNotificationEvent);
  }, [enabled, permission, useInAppPanel, handleNotificationEvent]);

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
    isSupported: hasNotificationSupport(),
    currentNotification,
    clearNotification,
  };
};
