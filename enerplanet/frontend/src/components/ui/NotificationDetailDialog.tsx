import React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, Button } from '@spatialhub/ui';
import { Calendar, AlertCircle, AlertTriangle, Info, CheckCircle, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateTime24h } from '@/utils/dateHelpers';
import { useTranslation } from '@spatialhub/i18n';
import type { Notification } from '@/features/notifications/hooks/useNotificationsQuery';

interface NotificationTypeStyles {
  bg: string;
  text: string;
  border: string;
}

export function getNotificationTypeStyles(type: string): NotificationTypeStyles {
  switch (type) {
    case 'warning':
    case 'maintenance':
      return {
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800',
      };
    case 'error':
      return {
        bg: 'bg-red-50 dark:bg-red-900/20',
        text: 'text-red-600 dark:text-red-400',
        border: 'border-red-200 dark:border-red-800',
      };
    case 'success':
      return {
        bg: 'bg-green-50 dark:bg-green-900/20',
        text: 'text-green-600 dark:text-green-400',
        border: 'border-green-200 dark:border-green-800',
      };
    default:
      return {
        bg: 'bg-gray-100 dark:bg-gray-800',
        text: 'text-gray-700 dark:text-gray-300',
        border: 'border-gray-200 dark:border-gray-700',
      };
  }
}

export function getNotificationTypeIcon(type: string, className: string = 'w-5 h-5'): React.ReactNode {
  switch (type) {
    case 'warning':
      return <AlertTriangle className={className} />;
    case 'error':
      return <AlertCircle className={className} />;
    case 'success':
      return <CheckCircle className={className} />;
    case 'maintenance':
      return <Wrench className={className} />;
    default:
      return <Info className={className} />;
  }
}

interface NotificationDetailDialogProps {
  notification: Notification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageLabel?: string;
}

export const NotificationDetailDialog: React.FC<NotificationDetailDialogProps> = ({
  notification,
  open,
  onOpenChange,
  messageLabel,
}) => {
  const { t } = useTranslation();

  if (!notification) return null;

  const typeStyles = getNotificationTypeStyles(notification.type);
  const label = messageLabel || t('notifications.details');

  const getTypeLabel = (type: string): string => {
    const typeKey = type || 'info';
    return t(`notifications.types.${typeKey}`, { defaultValue: type?.charAt(0).toUpperCase() + type?.slice(1) || 'Info' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden rounded-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{notification.title}</DialogTitle>
        <DialogDescription className="sr-only">
          {notification.type} notification details
        </DialogDescription>

        {/* Header */}
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className={cn("flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center", typeStyles.bg, typeStyles.text)}>
              {getNotificationTypeIcon(notification.type)}
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <h2 className="text-base font-semibold text-foreground">
                {notification.title}
              </h2>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDateTime24h(notification.created_at)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Type Badge */}
        <div className="px-5 pb-3">
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
            typeStyles.bg, typeStyles.text
          )}>
            {getNotificationTypeIcon(notification.type, 'w-3.5 h-3.5')}
            {getTypeLabel(notification.type)}
          </span>
        </div>

        {/* Scheduled Time */}
        {notification.scheduled_at && (
          <div className="mx-5 mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('notifications.scheduledFor')}
            </p>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {formatDateTime24h(notification.scheduled_at)}
            </p>
          </div>
        )}

        {/* Service Info */}
        {notification.service && (
          <div className="mx-5 mb-3 p-3 bg-muted rounded-lg">
            <p className="text-xs font-medium text-muted-foreground mb-1">{t('notifications.service')}</p>
            <p className="text-sm font-medium text-foreground capitalize">
              {notification.service}
            </p>
          </div>
        )}

        {/* Message */}
        <div className="mx-5 mb-4 p-3 bg-muted rounded-lg">
          <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
            {notification.message}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-muted border-t border-border flex justify-end">
          <Button
            onClick={() => onOpenChange(false)}
            variant="ghost"
            className="h-9 px-4 text-sm font-medium rounded-lg"
          >
            {t('notifications.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
