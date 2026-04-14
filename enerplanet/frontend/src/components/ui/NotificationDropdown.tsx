import React, { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";
import { TimeAgo } from "@/components/ui/TimeAgo";
import {
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useClearAllNotificationsMutation,
  type Notification,
} from "@/features/notifications/hooks/useNotificationsQuery";
import {
  NotificationDetailDialog,
  getNotificationTypeStyles,
  getNotificationTypeIcon,
} from "./NotificationDetailDialog";

export const NotificationDropdown: React.FC = () => {
  const { t } = useTranslation();
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const lastUnreadCountRef = useRef(0);

  // Fetch notifications with React Query (auto-polls every 30 seconds)
  const { data } = useNotificationsQuery();
  const notifications = data?.notifications || [];

  // Mutations
  const markAsReadMutation = useMarkNotificationReadMutation();
  const markAllAsReadMutation = useMarkAllNotificationsReadMutation();
  const clearAllMutation = useClearAllNotificationsMutation();

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Show pulse animation for 15 seconds when new notifications arrive
  useEffect(() => {
    if (unreadCount > lastUnreadCountRef.current) {
      setShowPulse(true);
      const timer = setTimeout(() => setShowPulse(false), 15000);
      return () => clearTimeout(timer);
    }
    lastUnreadCountRef.current = unreadCount;
  }, [unreadCount]);

  // Show only the 3 most recent notifications in dropdown
  const recentNotifications = notifications.slice(0, 3);

  const markAsRead = async (id: string | number) => {
    try {
      await markAsReadMutation.mutateAsync(id);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to mark notification as read:', error);
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
    try {
      await clearAllMutation.mutateAsync();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to clear notifications:', error);
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read
    await markAsRead(notification.id);

    // Show notification details
    setSelectedNotification(notification);
    setDetailDialogOpen(true);
  };

  return (
    <>
    <Tooltip>
      <DropdownMenu>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative px-3 py-2 rounded-lg transition-colors group bg-secondary text-secondary-foreground hover:bg-secondary/80 cursor-pointer"
            >
              <Bell className={cn(
                "w-5 h-5 transition-transform duration-200",
                unreadCount > 0 && "group-hover:rotate-12"
              )} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center">
                  {showPulse && (
                    <span className="absolute inline-flex h-5 w-5 rounded-full bg-foreground/40 animate-ping"></span>
                  )}
                  <span className="relative inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-foreground text-[10px] font-semibold text-background shadow-sm">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{t('notifications.title')}</p>
        </TooltipContent>
      <DropdownMenuContent align="end" className="w-80 p-0 rounded-xl border border-border shadow-xl overflow-hidden bg-card z-[52]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-muted border-b border-border">
          <h3 className="font-semibold text-sm text-foreground">
            {t('notifications.title')}
          </h3>
          {notifications.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={markAllAsRead}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('notifications.markAllRead')}
              </button>
              <span className="text-muted-foreground/50">|</span>
              <button
                onClick={clearAllNotifications}
                className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
              >
                {t('notifications.clearAll')}
              </button>
            </div>
          )}
        </div>

        {/* Notifications List */}
        {notifications.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <Bell className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">{t('notifications.noNotifications')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('notifications.allCaughtUp')}</p>
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {recentNotifications.map((notification) => {
              const typeStyles = getNotificationTypeStyles(notification.type);
              return (
                <DropdownMenuItem
                  key={notification.id}
                  className={cn(
                    "px-4 py-3 cursor-pointer rounded-none border-b border-border last:border-b-0 focus:bg-accent",
                    !notification.read && "bg-muted/50"
                  )}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <div className="flex items-start gap-3 w-full">
                    {/* Icon */}
                    <div className={cn("flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center", typeStyles.bg, typeStyles.text)}>
                      {getNotificationTypeIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          "text-sm text-foreground line-clamp-1",
                          notification.read ? "font-medium" : "font-semibold"
                        )}>
                          {notification.title}
                        </p>
                        {!notification.read && (
                          <span className="flex-shrink-0 w-2 h-2 rounded-full bg-foreground mt-1.5"></span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                        {notification.message}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1.5">
                        <TimeAgo date={notification.created_at} />
                      </p>
                    </div>
                  </div>
                </DropdownMenuItem>
              );
            })}
            
            {/* Show count of remaining notifications */}
            {notifications.length > 3 && (
              <div className="px-4 py-2 text-center text-xs text-muted-foreground bg-muted">
                {t(notifications.length - 3 === 1 ? 'notifications.moreNotification' : 'notifications.moreNotifications', { count: notifications.length - 3 })}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t border-border px-4 py-2.5 bg-muted">
            <button 
              onClick={() => {
                globalThis.location.href = '/notifications';
              }}
              className="w-full text-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('notifications.viewAll')}
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  </Tooltip>

    {/* Notification Detail Dialog */}
    <NotificationDetailDialog
      notification={selectedNotification}
      open={detailDialogOpen}
      onOpenChange={setDetailDialogOpen}
      messageLabel={t('notifications.details')}
    />
  </>
  );
};
