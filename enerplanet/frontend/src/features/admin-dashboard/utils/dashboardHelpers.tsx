import type { ReactNode } from 'react';
import { Brain, FileText, Info, Layers, LayoutDashboard, Shield, Users, Zap, Activity } from 'lucide-react';
import type { User as AuthUser } from '@/types/user';

const BG_GRAY_100 = 'bg-gray-100';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface DashboardTab {
  key: 'overview' | 'models' | 'webservices' | 'pylovo' | 'feedback' | 'users';
  label: string;
  show: boolean;
}

interface DashboardStatsCard {
  title: string;
  value: string | number;
  icon: ReactNode;
  color: string;
  bgColor: string;
  trend: string;
  _loading?: boolean;
}

export const dashboardTabIcons: Record<DashboardTab['key'], ReactNode> = {
  overview: <LayoutDashboard className="w-4 h-4" />,
  models: <Brain className="w-4 h-4" />,
  webservices: <Zap className="w-4 h-4" />,
  pylovo: <Activity className="w-4 h-4" />,
  feedback: <FileText className="w-4 h-4" />,
  users: <Users className="w-4 h-4" />,
};

export function getDashboardTabs(t: TranslateFn, canManageUsers: boolean, isExpert: boolean): DashboardTab[] {
  return [
    { label: t('adminDashboard.tabs.overview'), show: true, key: 'overview' },
    { label: t('adminDashboard.tabs.allSimulationModels'), show: canManageUsers, key: 'models' },
    { label: t('adminDashboard.tabs.simulationEngine'), show: true, key: 'webservices' },
    { label: t('adminDashboard.tabs.gridEngine'), show: true, key: 'pylovo' },
    { label: t('adminDashboard.tabs.feedback'), show: isExpert, key: 'feedback' },
    { label: t('adminDashboard.tabs.userManagement'), show: canManageUsers, key: 'users' },
  ];
}

export function getAccessLevelName(level: string, t: TranslateFn): string {
  const names: Record<string, string> = {
    expert: t('adminDashboard.accessLevels.expert'),
    manager: t('adminDashboard.accessLevels.manager'),
    intermediate: t('adminDashboard.accessLevels.intermediate'),
    very_low: t('adminDashboard.accessLevels.veryLow'),
  };
  return names[level] || t('adminDashboard.accessLevels.unknown');
}

export function getAvailableLayers(level: string, t: TranslateFn): string[] {
  if (level === 'expert' || level === 'manager') {
    return [t('adminDashboard.accessPermissions.allLayersAvailable'), t('adminDashboard.accessPermissions.fullSystemAccess')];
  }
  if (level === 'intermediate') {
    return [
      t('adminDashboard.accessPermissions.energyRiskFinal'),
      t('adminDashboard.accessPermissions.vegetationRisk'),
      t('adminDashboard.accessPermissions.topographyRisk'),
    ];
  }
  if (level === 'very_low') {
    return [t('adminDashboard.accessPermissions.energyRiskFinal')];
  }
  return [];
}

export function getAccessProgress(level: string): number {
  const progress: Record<string, number> = {
    expert: 100,
    manager: 80,
    intermediate: 66,
    very_low: 33,
  };
  return progress[level] || 0;
}

export function getAccessLevelColor(level: string): string {
  const colors: Record<string, string> = {
    expert: 'bg-gradient-to-r from-gray-600 to-gray-700 text-white border-gray-600',
    manager: 'bg-gradient-to-r from-blue-600 to-blue-700 text-white border-blue-600',
    intermediate: 'bg-gradient-to-r from-gray-400 to-gray-500 text-white border-gray-400',
    very_low: 'bg-gradient-to-r from-gray-300 to-gray-400 text-gray-900 border-gray-300',
  };
  return colors[level] || 'bg-gradient-to-r from-gray-200 to-gray-300 text-gray-800 border-gray-200';
}

function getLayersTrend(accessLevel: string, t: TranslateFn): string {
  if (accessLevel === 'expert' || accessLevel === 'manager') return t('adminDashboard.stats.allMapLayers');
  if (accessLevel === 'intermediate') return t('adminDashboard.stats.mapLayers', { count: 3 });
  return t('adminDashboard.stats.mapLayer', { count: 1 });
}

function getAccessLevelTrend(accessLevel: string, t: TranslateFn): string {
  const trends: Record<string, string> = {
    expert: t('adminDashboard.accessTrends.maximum'),
    manager: t('adminDashboard.accessTrends.management'),
    intermediate: t('adminDashboard.accessTrends.upgradable'),
    very_low: t('adminDashboard.accessTrends.basic'),
  };
  return trends[accessLevel] || t('adminDashboard.accessTrends.basic');
}

function getUsersValue(canManageUsers: boolean, loading: boolean, count: number | null | undefined, t: TranslateFn): string | number {
  if (!canManageUsers) return t('time.justNow');
  if (loading) return '';
  const val = count ?? 0;
  return typeof val === 'number' ? val : 0;
}

function getUsersTrend(canManageUsers: boolean, loading: boolean, onlineCount: number | null | undefined, t: TranslateFn): string {
  if (!canManageUsers) return t('adminDashboard.stats.recent');
  if (loading) return t('adminDashboard.stats.updating');
  if (onlineCount != null && onlineCount > 0) return `${onlineCount} ${t('adminDashboard.stats.online')}`;
  return t('adminDashboard.stats.live');
}

export function buildStatsCards(
  user: AuthUser | null | undefined,
  canManageUsers: boolean,
  usersCount: number | null | undefined,
  usersCountLoading: boolean,
  t: TranslateFn,
  onlineCount?: number | null
): DashboardStatsCard[] {
  const accessLevel = user?.access_level || '';
  const availableLayersCount = (accessLevel === 'expert' || accessLevel === 'manager')
    ? 'All'
    : getAvailableLayers(accessLevel, t).length.toString();

  return [
    {
      title: t('adminDashboard.stats.accessLevel'),
      value: getAccessLevelName(accessLevel, t),
      icon: <Shield className="w-4 h-4 text-gray-600 dark:text-gray-300" />,
      color: BG_GRAY_100,
      bgColor: 'bg-blue-50',
      trend: getAccessLevelTrend(accessLevel, t),
    },
    {
      title: t('adminDashboard.stats.availableLayers'),
      value: availableLayersCount,
      icon: <Layers className="w-4 h-4 text-gray-600 dark:text-gray-300" />,
      color: BG_GRAY_100,
      bgColor: 'bg-green-50',
      trend: getLayersTrend(accessLevel, t),
    },
    {
      title: t('adminDashboard.stats.status'),
      value: t('adminDashboard.stats.active'),
      icon: <Activity className="w-4 h-4 text-gray-600 dark:text-gray-300" />,
      color: BG_GRAY_100,
      bgColor: 'bg-green-50',
      trend: t('adminDashboard.stats.online'),
    },
    {
      title: canManageUsers ? t('adminDashboard.stats.totalUsers') : t('adminDashboard.stats.lastLogin'),
      value: getUsersValue(canManageUsers, usersCountLoading, usersCount, t),
      icon: canManageUsers
        ? <Users className="w-4 h-4 text-gray-600 dark:text-gray-300" />
        : <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />,
      color: BG_GRAY_100,
      bgColor: 'bg-purple-50',
      trend: getUsersTrend(canManageUsers, usersCountLoading, onlineCount, t),
      _loading: usersCountLoading,
    },
  ];
}
