import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { IconX } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@spatialhub/i18n';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  timestamp: Date;
}

interface NotificationPanelProps {
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

const GRADIENT_GRAY = 'from-gray-800 to-gray-900 dark:from-gray-700 dark:to-gray-800';
const BG_GRAY_700 = 'bg-gray-700 dark:bg-gray-600';
const BG_GRAY_600 = 'bg-gray-600 dark:bg-gray-500';

const NOTIFICATION_CONFIG = {
  success: {
    gradient: GRADIENT_GRAY,
    iconBg: BG_GRAY_700,
    progressBar: BG_GRAY_600,
    icon: CheckCircle2,
    label: 'Success',
  },
  error: {
    gradient: GRADIENT_GRAY,
    iconBg: BG_GRAY_700,
    progressBar: BG_GRAY_600,
    icon: AlertCircle,
    label: 'Error',
  },
  warning: {
    gradient: GRADIENT_GRAY,
    iconBg: BG_GRAY_700,
    progressBar: BG_GRAY_600,
    icon: AlertTriangle,
    label: 'Warning',
  },
  info: {
    gradient: GRADIENT_GRAY,
    iconBg: BG_GRAY_700,
    progressBar: BG_GRAY_600,
    icon: Info,
    label: 'Info',
  },
} as const;

const NotificationPanel: React.FC<NotificationPanelProps> = ({ notification, onClose }) => {
  const { t } = useTranslation();
  const [displayedNotification, setDisplayedNotification] = useState<Notification | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);
  const [progress, setProgress] = useState(100);
  
  const isClosingRef = useRef(false);
  const lastShownIdRef = useRef<number | null>(null);
  
  // Translate notification title if a known pattern exists
  const getTranslatedTitle = useCallback((title: string): string => {
    const translationKey = NOTIFICATION_TITLE_KEYS[title];
    if (translationKey) {
      return t(translationKey, { defaultValue: title });
    }
    return title;
  }, [t]);
  
  // Translate notification message if a known pattern exists
  const getTranslatedMessage = useCallback((message: string): string => {
    for (const { pattern, key, extractParams } of NOTIFICATION_MESSAGE_PATTERNS) {
      const match = message.match(pattern);
      if (match) {
        const params = extractParams(match);
        return t(key, { ...params, defaultValue: message });
      }
    }
    return message;
  }, [t]);
  const timersRef = useRef<{ progress?: NodeJS.Timeout; close?: NodeJS.Timeout }>({});

  const clearTimers = useCallback(() => {
    if (timersRef.current.progress) {
      clearInterval(timersRef.current.progress);
      timersRef.current.progress = undefined;
    }
    if (timersRef.current.close) {
      clearTimeout(timersRef.current.close);
      timersRef.current.close = undefined;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    
    clearTimers();
    setIsLeaving(true);
    
    setTimeout(() => {
      setDisplayedNotification(null);
      setIsLeaving(false);
      setProgress(100);
      isClosingRef.current = false;
      onClose();
    }, 400);
  }, [onClose, clearTimers]);

  useEffect(() => {
    if (notification && notification.id !== lastShownIdRef.current) {
      lastShownIdRef.current = notification.id;
      
      clearTimers();
      setDisplayedNotification(notification);
      setIsLeaving(false);
      setProgress(100);
      isClosingRef.current = false;

      const duration = 10000;
      const interval = 50;
      const decrement = (interval / duration) * 100;

      timersRef.current.progress = setInterval(() => {
        setProgress(prev => {
          if (prev <= 0) {
            if (timersRef.current.progress) {
              clearInterval(timersRef.current.progress);
            }
            return 0;
          }
          return prev - decrement;
        });
      }, interval);

      timersRef.current.close = setTimeout(() => {
        handleClose();
      }, duration);
    }
  }, [notification, handleClose, clearTimers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  if (!displayedNotification) return null;

  const config = NOTIFICATION_CONFIG[displayedNotification.type] || NOTIFICATION_CONFIG.info;
  const IconComponent = config.icon;
  const translatedTitle = getTranslatedTitle(displayedNotification.title);
  const translatedMessage = getTranslatedMessage(displayedNotification.message);
  const translatedLabel = t(`notifications.types.${displayedNotification.type}`, { defaultValue: config.label });

  return (
    <div className="fixed top-20 right-6 z-[9999] pointer-events-none">
      <div
        className={cn(
          'pointer-events-auto w-[340px] overflow-hidden',
          'bg-white dark:bg-gray-900 rounded-2xl',
          'shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)]',
          'border border-gray-100 dark:border-gray-700',
          'transform transition-all duration-400 ease-out',
          isLeaving 
            ? 'translate-x-[120%] opacity-0' 
            : 'translate-x-0 opacity-100'
        )}
      >
        {/* Gradient header */}
        <div className={cn('bg-gradient-to-r p-4', config.gradient)}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", config.iconBg)}>
                <IconComponent className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-xs font-medium text-gray-400 dark:text-gray-300 uppercase tracking-wider">
                  {translatedLabel}
                </span>
                <h4 className="text-sm font-semibold text-white leading-tight mt-0.5">
                  {translatedTitle}
                </h4>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-400 dark:text-gray-300 hover:text-white transition-colors"
            >
              <IconX className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-3">
            {translatedMessage}
          </p>
          
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {displayedNotification.timestamp.toLocaleTimeString('en-GB', { 
                hour: '2-digit', 
                minute: '2-digit',
                hour12: false
              })}
            </span>
            <button
              onClick={handleClose}
              className="text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              {t('notifications.dismiss')}
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100 dark:bg-gray-800">
          <div
            className={cn('h-full transition-all duration-100 ease-linear', config.progressBar)}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default NotificationPanel;
