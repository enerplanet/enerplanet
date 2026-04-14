import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { getManagedUsersCount } from '@/features/admin-dashboard/services/adminDashboardService';

export function useAdminUsersCount(enabled: boolean) {
  const { usersCount, setUsersCount } = useAppStore();
  const [usersCountLoading, setUsersCountLoading] = useState(false);
  const [onlineCount, setOnlineCount] = useState<number>(0);

  const refreshUsersCount = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setUsersCountLoading(true);
    try {
      const result = await getManagedUsersCount();
      setUsersCount(result.total);
      setOnlineCount(result.online);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to load users count:', error);
      }
    } finally {
      setUsersCountLoading(false);
    }
  }, [enabled, setUsersCount]);

  useEffect(() => {
    void refreshUsersCount();
  }, [refreshUsersCount]);

  return {
    usersCount,
    usersCountLoading,
    onlineCount,
    refreshUsersCount,
  };
}
