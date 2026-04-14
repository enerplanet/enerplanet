import { useState, useRef, useMemo } from 'react';
import { Bell } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { TimeAgo } from '@/components/ui/TimeAgo';
import { Button } from '@spatialhub/ui';
import { useTranslation } from '@spatialhub/i18n';
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useClearAllNotificationsMutation,
  type Notification,
} from '@/features/notifications/hooks/useNotificationsQuery';
import {
  NotificationDetailDialog,
  getNotificationTypeStyles,
  getNotificationTypeIcon,
} from '@/components/ui/NotificationDetailDialog';
import { useConfirm } from '@/hooks/useConfirmDialog';

const NotificationsPage = () => {
  const { t } = useTranslation();
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const confirm = useConfirm();

  // Fetch notifications with React Query (last 30 days, auto-refetches every 30s)
  const { data, isLoading } = useNotificationsQuery({ last30Days: true });
  const notifications = useMemo(() => data?.notifications || [], [data?.notifications]);

  // Mutations
  const markAsReadMutation = useMarkNotificationReadMutation();
  const markAllAsReadMutation = useMarkAllNotificationsReadMutation();
  const clearAllMutation = useClearAllNotificationsMutation();

  const markAsRead = async (id: number | string) => {
    try {
      await markAsReadMutation.mutateAsync(id);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to mark as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await markAllAsReadMutation.mutateAsync();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to mark all as read:', error);
    }
  };

  const clearAllNotifications = async () => {
    await confirm({
      title: t('notifications.confirmClearTitle'),
      description: t('notifications.confirmClearDescription'),
      confirmLabel: t('notifications.confirmClearButton'),
      cancelLabel: t('common.cancel'),
      type: "delete",
      onConfirm: async () => {
        try {
          await clearAllMutation.mutateAsync();
        } catch (error) {
          if (import.meta.env.DEV) console.error('Failed to clear notifications:', error);
        }
      }
    });
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    setSelectedNotification(notification);
    setDetailDialogOpen(true);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  // Virtualization setup
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: notifications.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl bg-background flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="mb-8 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
              <Bell className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                {t('notifications.title')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('notifications.last30Days')} {unreadCount > 0 && (
                  <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground">
                    {t('notifications.unread', { count: unreadCount })}
                  </span>
                )}
              </p>
            </div>
          </div>
          
          {notifications.length > 0 && (
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  onClick={markAllAsRead}
                  variant="ghost"
                  className="h-9 px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  {t('notifications.markAllRead')}
                </Button>
              )}
              <Button
                onClick={clearAllNotifications}
                variant="ghost"
                className="h-9 px-4 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                {t('notifications.clearAll')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Notifications List Container */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="text-center py-16 h-full flex flex-col justify-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-muted border-t-foreground mx-auto"></div>
            <p className="mt-4 text-sm text-muted-foreground">{t('notifications.loading')}</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 bg-card rounded-2xl border border-border">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Bell className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">{t('notifications.noNotifications')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('notifications.allCaughtUp')}</p>
          </div>
        ) : (
          <div 
            ref={parentRef}
            className="h-full overflow-y-auto no-scrollbar pr-1"
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const notification = notifications[virtualRow.index];
                const typeStyles = getNotificationTypeStyles(notification.type);
                
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: '12px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => { void handleNotificationClick(notification); }}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border cursor-pointer transition-all duration-200",
                        "hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600",
                        notification.read
                          ? "bg-card border-border"
                          : "bg-muted/50 border-border"
                      )}
                    >
                      <div className="flex items-start gap-4">
                        <div className={cn("flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center", typeStyles.bg, typeStyles.text)}>
                          {getNotificationTypeIcon(notification.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <h3 className={cn(
                              "text-base text-foreground",
                              notification.read ? "font-medium" : "font-semibold"
                            )}>
                              {notification.title}
                            </h3>
                            {!notification.read && (
                              <span className="flex-shrink-0 w-2.5 h-2.5 bg-foreground rounded-full mt-1.5"></span>
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {notification.message}
                          </p>
                          
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">
                              <TimeAgo date={notification.created_at} />
                            </span>
                            {notification.service && (
                              <>
                                <span className="text-muted-foreground/50">•</span>
                                <span className="text-muted-foreground capitalize">{notification.service}</span>
                              </>
                            )}
                            <span className="text-muted-foreground/50">•</span>
                            <span className={cn(
                              "px-2 py-0.5 rounded-full font-medium capitalize",
                              typeStyles.bg,
                              typeStyles.text
                            )}>
                              {notification.type}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Notification Detail Dialog */}
      <NotificationDetailDialog
        notification={selectedNotification}
        open={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
      />
    </div>
  );
};

export default NotificationsPage;
