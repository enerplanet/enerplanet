import { useEffect, type FC } from 'react';
import { useTranslation } from '@spatialhub/i18n';
import { useToastStore } from '@/features/notifications/toastStore';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  timestamp: Date;
}

interface IncomingNotificationsProps {
  notification: Notification | null;
  onClose: () => void;
}

// Translation key mappings for known notification patterns
const NOTIFICATION_TITLE_KEYS: Record<string, string> = {
  'Model Calculation Complete': 'notifications.messages.modelCalculationComplete',
  'Model Calculation Failed': 'notifications.messages.modelCalculationFailed',
  'Model Calculation Started': 'notifications.messages.modelCalculationStarted',
};

const NOTIFICATION_MESSAGE_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  extractParams: (match: RegExpMatchArray) => Record<string, string>;
}> = [
  {
    pattern: /Your model '(.+)' has been successfully calculated and is ready to view/,
    key: 'notifications.messages.modelCalculationCompleteMessage',
    extractParams: (match) => ({ modelName: match[1] }),
  },
  {
    pattern: /Your model '(.+)' calculation has failed/,
    key: 'notifications.messages.modelCalculationFailedMessage',
    extractParams: (match) => ({ modelName: match[1] }),
  },
  {
    pattern: /Your model '(.+)' calculation has started/,
    key: 'notifications.messages.modelCalculationStartedMessage',
    extractParams: (match) => ({ modelName: match[1] }),
  },
];

/**
 * Puts each incoming notification into the toast stack once, translated where
 * a known title or message pattern matches. Renders nothing itself.
 */
const IncomingNotifications: FC<IncomingNotificationsProps> = ({ notification, onClose }) => {
  const { t } = useTranslation();
  const push = useToastStore((s) => s.push);

  useEffect(() => {
    if (!notification) return;
    const titleKey = NOTIFICATION_TITLE_KEYS[notification.title];
    let message = notification.message;
    for (const { pattern, key, extractParams } of NOTIFICATION_MESSAGE_PATTERNS) {
      const match = notification.message.match(pattern);
      if (match) {
        message = t(key, { ...extractParams(match), defaultValue: notification.message });
        break;
      }
    }
    push({
      severity: notification.type,
      title: titleKey ? t(titleKey, { defaultValue: notification.title }) : notification.title,
      message,
    });
    onClose();
  }, [notification, onClose, push, t]);

  return null;
};

export default IncomingNotifications;
