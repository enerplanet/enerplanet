import React, { useState, useEffect } from 'react';
import { useBrowserNotifications } from '@/features/notifications/hooks/useBrowserNotifications';
import NotificationPanel from './NotificationPanel';
import { settingsService } from '@/features/settings/services/settings';
import { useAuthStore } from '@/store/auth-store';

const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const user = useAuthStore((state) => state.user);

  // Load notification preferences only when user is authenticated
  useEffect(() => {
    const loadPreferences = async () => {
      // Skip loading if user is not authenticated
      if (!user) {
        setLoading(false);
        return;
      }
      
      try {
        const prefs = await settingsService.getNotificationPreferences();
        setBrowserNotificationsEnabled(prefs.browser);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Failed to load notification preferences:', error);
      } finally {
        setLoading(false);
      }
    };

    loadPreferences();
  }, [user]);

  // Only enable browser notifications when user is authenticated
  const { currentNotification, clearNotification } = useBrowserNotifications(
    browserNotificationsEnabled && !!user,
    true // Use in-app panel
  );

  if (loading) {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <NotificationPanel
        notification={currentNotification}
        onClose={clearNotification}
      />
    </>
  );
};

export default NotificationProvider;
