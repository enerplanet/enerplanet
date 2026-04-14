import React, { useState, useEffect } from "react";
import { Mail, Smartphone, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { settingsService } from "@/features/settings/services/settings";
import { useTranslation } from "@spatialhub/i18n";

type NotificationToggle = "email" | "browser";

interface PreferenceState {
  email: boolean;
  browser: boolean;
}

const NotificationSettings: React.FC = () => {
  const { t } = useTranslation();
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [browserNotifications, setBrowserNotifications] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const isSupported = typeof globalThis !== 'undefined' && 'Notification' in globalThis;

  useEffect(() => {
    loadPreferences();
    if (isSupported && typeof Notification !== 'undefined') {
      setPermission(Notification.permission);
    }
  }, [isSupported]);

  const loadPreferences = async () => {
    try {
      const prefs = await settingsService.getNotificationPreferences();
      setEmailNotifications(prefs.email);
      setBrowserNotifications(prefs.browser);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to load notification preferences:', error);
    } finally {
      setLoading(false);
    }
  };

  const requestPermission = async () => {
    if (!isSupported) return false;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      return result === 'granted';
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error requesting notification permission:', error);
      return false;
    }
  };

  const handleToggle = async (type: NotificationToggle) => {
    setSaving(true);
    setSaved(false);

    const previous: PreferenceState = {
      email: emailNotifications,
      browser: browserNotifications,
    };

    const updated: PreferenceState = {
      email: type === 'email' ? !emailNotifications : emailNotifications,
      browser: type === 'browser' ? !browserNotifications : browserNotifications,
    };

    if (type === 'browser' && updated.browser && permission !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        setSaving(false);
        return;
      }
    }

    setEmailNotifications(updated.email);
    setBrowserNotifications(updated.browser);

    try {
      const success = await settingsService.setNotificationPreferences(updated.email, updated.browser);
      if (success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setEmailNotifications(previous.email);
        setBrowserNotifications(previous.browser);
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to save preferences:', error);
      setEmailNotifications(previous.email);
      setBrowserNotifications(previous.browser);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <div className="text-xs text-gray-500 dark:text-gray-400">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Status indicator */}
      {saved && (
        <div className="flex items-center gap-1.5 text-green-600 text-[10px] bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
          <CheckCircle2 className="w-3 h-3" />
          <span>{t('common.saved')}</span>
        </div>
      )}

      {/* Notification Options */}
      <div className="space-y-2">
        {/* Email Notifications */}
        <div className={cn(
          "px-2.5 py-2 rounded-md border transition-all duration-200",
          emailNotifications 
            ? "border-primary/50 bg-muted/50" 
            : "border-border bg-card"
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "p-1.5 rounded",
                emailNotifications ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                <Mail className="w-3 h-3" />
              </div>
              <div>
                <h4 className="text-xs font-medium text-foreground">{t('settings.notifications.email')}</h4>
                <p className="text-[10px] text-muted-foreground">{t('settings.notifications.notifyWhenComplete')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('email')}
              disabled={saving}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                emailNotifications ? "bg-primary" : "bg-muted-foreground/30",
                saving && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                emailNotifications ? "translate-x-5" : "translate-x-0.5"
              )} />
            </button>
          </div>
        </div>

        {/* Browser Notifications */}
        <div className={cn(
          "px-2.5 py-2 rounded-md border transition-all duration-200",
          browserNotifications 
            ? "border-primary/50 bg-muted/50" 
            : "border-border bg-card"
        )}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className={cn(
                "p-1.5 rounded",
                browserNotifications ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}>
                <Smartphone className="w-3 h-3" />
              </div>
              <div>
                <h4 className="text-xs font-medium text-foreground">{t('settings.notifications.browser')}</h4>
                <p className="text-[10px] text-muted-foreground">
                  {browserNotifications && permission === 'granted' && (
                    <span className="text-green-600 dark:text-green-400">{t('settings.notifications.enabled')}</span>
                  )}
                  {browserNotifications && permission === 'denied' && (
                    <span className="text-red-600 dark:text-red-400">{t('settings.notifications.blocked')}</span>
                  )}
                  {(!browserNotifications || permission === 'default') && t('settings.notifications.systemAlerts')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleToggle('browser')}
              disabled={saving || !isSupported}
              className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                browserNotifications ? "bg-primary" : "bg-muted-foreground/30",
                (saving || !isSupported) && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                browserNotifications ? "translate-x-5" : "translate-x-0.5"
              )} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationSettings;
