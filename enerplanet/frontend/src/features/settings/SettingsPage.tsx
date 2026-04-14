import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/use-document-title';
import WeatherSettings from '@/features/weather/WeatherSettings';
import MapSettings from '@/features/settings/MapLocationSettings';
import NotificationSettings from '@/features/settings/NotificationSettings';
import DataDisplaySettings from '@/features/settings/DataDisplaySettings';
import LanguageSettings from '@/features/settings/LanguageSettings';
import NotificationManagement from '@/features/settings/NotificationManagement';
import PolygonLimitsSettings from '@/features/settings/PolygonLimitsSettings';
import RegionManagement from '@/features/settings/RegionManagement';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation, getCurrentLanguage } from '@spatialhub/i18n';
import { ACCESS_LEVEL_LABELS, type AccessLevel } from '@/features/polygon-drawer/store/polygon-limits-store';
import { 
  Globe, 
  Cloud, 
  MapPin, 
  Bell, 
  Sliders, 
  Send, 
  ArrowLeft, 
  Building2, 
  Sparkles,
  User,
  LayoutGrid,
  Monitor,
  Cog,
  Shield
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import LegalPage from "@/pages/legal/LegalPage";

type TabKey = 'general' | 'display' | 'notifications' | 'privacyTerms' | 'advanced';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  useDocumentTitle(t('settings.title'));
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isExpert = user?.access_level === 'expert';
  const [activeTab, setActiveTab] = useState<TabKey>('general');
  
  // Tab configuration with dark icons
  const TABS: { key: string; label: string; icon: typeof LayoutGrid; expertOnly?: boolean }[] = [
    { key: 'general', label: t('settings.tabs.general'), icon: LayoutGrid },
    { key: 'display', label: t('settings.tabs.display'), icon: Monitor },
    { key: 'notifications', label: t('settings.tabs.notifications'), icon: Bell },
    { key: 'privacyTerms', label: 'Privacy & Terms', icon: Shield },
    { key: 'advanced', label: t('settings.tabs.advanced'), icon: Cog, expertOnly: true },
  ];
  
  // Check if user came from admin dashboard
  const cameFromAdmin = location.state?.from === 'admin' || document.referrer.includes('admin-dashboard');
  
  const handleBack = () => {
    if (cameFromAdmin) {
      navigate('/app/admin-dashboard');
    } else {
      navigate(-1);
    }
  };

  // Filter tabs based on user access level
  const visibleTabs = TABS.filter(tab => !tab.expertOnly || isExpert);

  // Get current language info
  const currentLanguage = getCurrentLanguage();
  
  // Get translated access level label
  const getAccessLevelLabel = (level: AccessLevel | undefined) => {
    if (!level) return t('settings.stats.user');
    const labels: Record<AccessLevel, string> = {
      very_low: t('settings.polygonLimits.levels.basic'),
      intermediate: t('settings.polygonLimits.levels.intermediate'),
      manager: t('settings.polygonLimits.levels.manager'),
      expert: t('settings.polygonLimits.levels.expert'),
    };
    return labels[level] || ACCESS_LEVEL_LABELS[level] || t('settings.stats.user');
  };

  // Stats cards for settings
  const statsCards = [
    { title: t('settings.stats.language'), value: currentLanguage.nativeName, icon: <Globe className="w-3.5 h-3.5 text-muted-foreground" /> },
    { title: t('settings.stats.theme'), value: t('settings.stats.system'), icon: <Monitor className="w-3.5 h-3.5 text-muted-foreground" /> },
    { title: t('settings.stats.notifications'), value: t('settings.stats.enabled'), icon: <Bell className="w-3.5 h-3.5 text-muted-foreground" /> },
    { title: t('settings.stats.accessLevel'), value: getAccessLevelLabel(user?.access_level as AccessLevel), icon: <User className="w-3.5 h-3.5 text-muted-foreground" /> },
  ];
  
  return (
    <div className="min-h-screen bg-background">
      <div className="p-3 md:p-4 lg:p-5 max-w-[1600px] mx-auto space-y-4">
      {/* Header Section - Dark gradient like admin dashboard */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-800 via-gray-900 to-black p-4 md:p-5 text-white shadow-xl">
        {/* Background decorations */}
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50"></div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-radial from-white/5 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
        
        <div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleBack}
                  className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 transition-all duration-200 hover:scale-105"
                  aria-label={t('settings.goBack')}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.goBack')}</TooltipContent>
            </Tooltip>
            <div>
              <div className="flex items-center gap-2 text-gray-400 dark:text-gray-300 text-sm mb-1">
                <Sparkles className="w-4 h-4" />
                <span>{t('settings.configuration')}</span>
              </div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">
                {t('settings.title')}
              </h1>
              <p className="text-gray-300 text-sm">{t('settings.subtitle')}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10">
              <User className="w-4 h-4 text-gray-300" />
              <span className="text-sm font-medium">{user?.name}</span>
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-xs font-medium capitalize">
                {user?.access_level}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statsCards.map((stat) => (
          <div
            key={stat.title}
            className="group relative bg-card rounded-lg p-2.5 shadow-sm border border-border hover:shadow-md hover:border-ring transition-all duration-200 overflow-hidden"
          >
            <div className="relative flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-muted flex-shrink-0">
                {stat.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{stat.title}</p>
                <p className="text-sm font-bold text-foreground truncate capitalize">{stat.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Card with Tabs */}
      <div className="bg-card rounded-2xl shadow-sm border border-border">
        {/* Tab Navigation */}
        <div className="border-b border-border bg-muted/50">
          <nav className="flex overflow-x-auto scrollbar-hide px-2 md:px-4 py-2 gap-1">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as TabKey)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                    activeTab === tab.key
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="p-3 md:p-4">
          {activeTab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {/* Language Settings */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <Globe className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.language.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.language.subtitle')}</p>
                  </div>
                </div>
                <LanguageSettings />
              </div>

              {/* Weather Location */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <Cloud className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.weatherLocation.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.weatherLocation.subtitle')}</p>
                  </div>
                </div>
                <WeatherSettings />
              </div>

              {/* Map Location */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <MapPin className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.mapLocation.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.mapLocation.subtitle')}</p>
                  </div>
                </div>
                <MapSettings />
              </div>
            </div>
          )}

          {activeTab === 'display' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Data & Display */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <Sliders className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.dataDisplay.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.dataDisplay.subtitle')}</p>
                  </div>
                </div>
                <DataDisplaySettings />
              </div>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Notification Settings */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <Bell className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.notifications.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.notifications.subtitle')}</p>
                  </div>
                </div>
                <NotificationSettings />
              </div>

              {/* Notification Management - Expert only */}
              {isExpert && (
                <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 bg-muted rounded">
                      <Send className="w-3.5 h-3.5 text-foreground" />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-foreground">{t('settings.sendNotification.title')}</h3>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.sendNotification.subtitle')}</p>
                    </div>
                  </div>
                  <NotificationManagement />
                </div>
              )}
            </div>
          )}

          {activeTab === 'privacyTerms' && (
            <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
              <LegalPage />
            </div>
          )}

          {activeTab === 'advanced' && isExpert && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* Polygon Limits */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <Building2 className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">{t('settings.polygonLimits.title')}</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{t('settings.polygonLimits.subtitle')}</p>
                  </div>
                </div>
                <PolygonLimitsSettings />
              </div>

              {/* Region Management */}
              <div className="bg-gradient-to-br from-muted/50 to-card rounded-lg p-3 border border-border">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-muted rounded">
                    <MapPin className="w-3.5 h-3.5 text-foreground" />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-foreground">Cached Regions</h3>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Pipeline Data Management</p>
                  </div>
                </div>
                <RegionManagement />
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default SettingsPage;
