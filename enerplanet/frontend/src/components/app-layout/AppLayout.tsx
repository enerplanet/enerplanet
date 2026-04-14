import { Fragment, useMemo, useEffect, useState, useCallback } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useLocation, useNavigate } from "react-router-dom";
import OnboardingWizard from "@/features/onboarding/OnboardingWizard";
import { useOnboarding } from "@/features/onboarding/hooks/useOnboarding";
import { closeNotificationStream } from "@/features/notifications/hooks/useNotificationsQuery";
import { useTranslation } from "@spatialhub/i18n";

import {
  Layers,
  LogOut,
  MapIcon,
  Settings,
  User,
  BookOpen,
  GraduationCap,
  MessageSquareText,
  HousePlug,
  MapPinHouse,
  GitCompareArrows,
  LucideIcon,
  Globe2,
  Cpu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Separator,
  Button,
  Label,
} from "@spatialhub/ui";
import SidebarButton from "@/components/ui/SidebarButton";
import { LayerInfo, layers, useMapStore } from "@/features/interactive-map/store/map-store";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useProductTour } from "@/features/guided-tour/hooks/useProductTour";
import { Authorized } from "@/middleware/authorized";
import { useAuthStore } from "@/store/auth-store";
import WeatherDropdown from "@/features/weather/weather";
import { SessionTimer } from "@/components/ui/SessionTimer";
import { SessionExpiryBanner } from "@/components/ui/SessionExpiryBanner";
import { NotificationDropdown } from "@/components/ui/NotificationDropdown";
import { APP_VERSION } from "@/version";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Constants
const SIDEBAR_WIDTH = "56px";
const TOPBAR_HEIGHT = "4rem";
const DOCUMENTATION_URL = "https://docs.spatialhub.io";

// Types
interface SidebarItem {
  path: string;
  icon: LucideIcon;
  title: string;
  color: string;
  bgColor: string;
  dataTour: string;
}

interface UserMenuItem {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuthStore();
  const { startTour, restartAreaSelectTour } = useProductTour();
  const baseLayers = useMapStore((s) => s.layers);
  const selectedBaseLayerId = useMapStore((s) => s.selectedBaseLayerId);
  const setSelectedBaseLayerId = useMapStore((s) => s.setSelectedBaseLayerId);
  const { t } = useTranslation();

  const ADMIN_PATH = "/app/admin-dashboard";

  const isActive = (path: string) => {
    return location.pathname === path || (path === ADMIN_PATH && location.pathname === "/");
  };

  const hasAccessToLayer = useCallback(
    (layer: { accessLevel: "very_low" | "intermediate" | "manager" | "expert" }): boolean => {
      if (!user) return false;

      const accessLevels: ("very_low" | "intermediate" | "manager" | "expert")[] = [
        "very_low",
        "intermediate",
        "manager",
        "expert",
      ];

      const userLevel = accessLevels.indexOf(user.access_level);
      const requiredLevel = accessLevels.indexOf(layer.accessLevel);

      return (
        userLevel >= requiredLevel ||
        user.access_level === "expert" ||
        user.access_level === "manager"
      );
    },
    [user]
  );

  const changeBaseLayer = (index: number) => {
    const layer = baseLayers.at(index);
    if (!layer) return;
    setSelectedBaseLayerId(layer.id);
  };

  const accessibleBaseLayers = useMemo(
    () => baseLayers.filter((l) => hasAccessToLayer(l)),
    [baseLayers, hasAccessToLayer]
  );

  useEffect(() => {
    if (
      selectedBaseLayerId &&
      accessibleBaseLayers.length > 0 &&
      !accessibleBaseLayers.some((l) => l.id === selectedBaseLayerId)
    ) {
      setSelectedBaseLayerId(accessibleBaseLayers[0].id);
    }
  }, [selectedBaseLayerId, accessibleBaseLayers, setSelectedBaseLayerId]);

  const navigationHandlers = useMemo(
    () => ({
      profile: () => navigate("/app/profile"),
      settings: () => navigate("/app/settings"),
      dashboard: () => navigate(ADMIN_PATH),
      login: () => navigate("/login"),
      feedback: () => navigate("/app/feedback"),
      documentation: () => window.open(DOCUMENTATION_URL, "_blank", "noopener,noreferrer"),
      logout: async () => {
        closeNotificationStream();
        logout();
        navigate("/");
      },
    }),
    [navigate, logout]
  );

  const handleSmartRestartTour = () => {
    const isAreaSelectPage =
      location.pathname.includes("/app/model-dashboard/new-model") ||
      location.pathname.includes("/app/model-dashboard/edit/");

    if (isAreaSelectPage) {
      restartAreaSelectTour();
    } else {
      startTour();
    }
  };

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      {
        path: "/app/model-dashboard",
        icon: HousePlug,
        title: t("common.sidebar.energySimulations"),
        color: "#8b5cf6",
        bgColor: "#ede9fe",
        dataTour: "simulations",
      },
      {
        path: "/app/map",
        icon: Globe2,
        title: t("common.sidebar.map"),
        color: "#3b82f6",
        bgColor: "#dbeafe",
        dataTour: "map",
      },
      {
        path: "/app/locations",
        icon: MapPinHouse,
        title: t("common.sidebar.locations"),
        color: "#ef4444",
        bgColor: "#fee2e2",
        dataTour: "locations",
      },
      {
        path: "/app/simulation-reports",
        icon: GitCompareArrows,
        title: t("common.sidebar.simulationReports"),
        color: "#10b981",
        bgColor: "#d1fae5",
        dataTour: "reports",
      },
      {
        path: "/app/technologies",
        icon: Cpu,
        title: t("common.sidebar.technologies"),
        color: "#f59e0b",
        bgColor: "#fef3c7",
        dataTour: "technologies",
      },
    ],
    [t]
  );

  const userMenuItems: UserMenuItem[] = useMemo(
    () => [
      {
        icon: User,
        label: t("common.menu.profile"),
        onClick: navigationHandlers.profile,
      },
      {
        icon: Settings,
        label: t("common.menu.settings"),
        onClick: navigationHandlers.settings,
      },
      {
        icon: LogOut,
        label: t("common.menu.logout"),
        onClick: navigationHandlers.logout,
      },
    ],
    [navigationHandlers, t]
  );

  const getUserInitial = () => {
    return (user?.name || user?.email || "U").charAt(0).toUpperCase();
  };

  const { showOnboarding, completeOnboarding } = useOnboarding();

  const cssVariables = {
    "--sidebar-width": SIDEBAR_WIDTH,
    "--topbar-height": TOPBAR_HEIGHT,
  } as React.CSSProperties;

  return (
    <Fragment>
      <OnboardingWizard isOpen={showOnboarding} onComplete={completeOnboarding} />

      <div
        className="relative flex h-full w-full overflow-hidden bg-background text-foreground"
        style={cssVariables}
      >
        <header className="fixed top-0 left-0 right-0 z-[51] border-b border-border bg-card text-foreground h-[var(--topbar-height)]">
          <div className="flex items-center h-full px-4">
            <div className="flex items-center gap-3">
              <a
                href="/"
                onClick={(e) => { if (!e.ctrlKey && !e.metaKey && e.button === 0) { e.preventDefault(); navigate("/"); } }}
                className="cursor-pointer hover:opacity-80 transition-opacity"
              >
                <img
                  src="/images/logo/enerplanet-logo.png"
                  alt="EnerPlanET"
                  className="h-6 dark:brightness-0 dark:invert"
                  style={{ height: "24px", width: "auto" }}
                />
              </a>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-1 mr-4" data-tour="navigation">
              <Authorized>
                <NotificationDropdown />
              </Authorized>
              <Authorized>
                <WeatherDropdown showSettingsIcon={false} />
              </Authorized>
              <Authorized>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      onClick={navigationHandlers.dashboard}
                      className="relative group cursor-pointer px-3 py-2 rounded-lg transition-all duration-200 hover:scale-105 hover:shadow-md bg-card hover:bg-muted border border-border"
                    >
                      <div className="flex items-center gap-1.5">
                        <div className="p-1.5 rounded-lg bg-foreground shadow-sm">
                          <svg
                            className="w-4 h-4 text-background"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect x="3" y="3" width="7" height="7" rx="1" />
                            <rect x="14" y="3" width="7" height="7" rx="1" />
                            <rect x="3" y="14" width="7" height="7" rx="1" />
                            <rect x="14" y="14" width="7" height="7" rx="1" />
                          </svg>
                        </div>
                        <span className="text-xs font-medium text-foreground hidden sm:inline">
                          Dashboard
                        </span>
                      </div>
                      {isActive(ADMIN_PATH) && (
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3/5 h-0.5 rounded-full bg-foreground" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Dashboard</TooltipContent>
                </Tooltip>
              </Authorized>
            </div>

            <div className="flex items-center gap-2">
              <Authorized>
                <div className="relative" data-tour="profile">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="cursor-pointer rounded-full size-9 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 hover:from-gray-200 hover:to-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700 border border-gray-200 dark:border-gray-600 shadow-sm transition-all duration-200 hover:shadow-md group"
                        title={t("common.tooltips.profile")}
                      >
                        <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 group-hover:scale-105 transition-transform">
                          {getUserInitial()}
                        </div>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-52 z-[52]" align="end">
                      {/* Session Timer at top of dropdown */}
                      <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-700">
                        <SessionTimer warningThreshold={5} compact />
                      </div>
                      {/* Theme Toggle */}
                      <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                        <span className="text-sm text-foreground">{t("common.tooltips.theme")}</span>
                        <ThemeToggle />
                      </div>
                      {userMenuItems.map((item) => (
                        <DropdownMenuItem
                          key={item.label}
                          className="cursor-pointer"
                          onClick={item.onClick}
                        >
                          <item.icon className="w-4 h-4" />
                          {item.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Authorized>

              {!user && (
                <>
                  <ThemeToggle />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        onClick={navigationHandlers.login}
                        className="cursor-pointer rounded-full size-9 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 hover:from-gray-200 hover:to-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700 border border-gray-200 dark:border-gray-600 shadow-sm transition-all duration-200 hover:shadow-md group"
                      >
                        <svg
                          className="w-4 h-4 text-gray-700 dark:text-gray-300 group-hover:scale-110 transition-transform"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Login</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
        </header>

        <aside className="fixed left-0 bottom-0 bg-card border-r border-border shadow-lg z-[51] w-[var(--sidebar-width)] top-[var(--topbar-height)]">
          <div className="flex flex-col items-center gap-3 py-4">
            <Authorized>
              {sidebarItems.map((item) => (
                <SidebarButton
                  key={item.path}
                  icon={item.icon}
                  tooltip={item.title}
                  onClick={() => navigate(item.path)}
                  isActive={isActive(item.path)}
                  dataTour={item.dataTour}
                />
              ))}
            </Authorized>

            <LayersSheet
              baseLayers={accessibleBaseLayers}
              selectedBaseLayerId={selectedBaseLayerId}
              changeBaseLayer={changeBaseLayer}
              hasAccessToLayer={hasAccessToLayer}
            />
          </div>

          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 space-y-3 text-center">
            <SidebarButton
              icon={BookOpen}
              tooltip={t("common.tooltips.documentation")}
              onClick={navigationHandlers.documentation}
              isActive={false}
              dataTour="documentation"
            />

            <Authorized>
              <SidebarButton
                icon={GraduationCap}
                tooltip={t("common.tooltips.restartTour")}
                onClick={handleSmartRestartTour}
                isActive={false}
                dataTour="restart-tour"
              />
            </Authorized>

            <SidebarButton
              icon={MessageSquareText}
              tooltip={t("common.tooltips.feedback")}
              onClick={() => navigationHandlers.feedback()}
              isActive={isActive("/app/feedback")}
              dataTour="feedback"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium select-none cursor-default">
                  v{APP_VERSION}
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Application Version: {APP_VERSION}
              </TooltipContent>
            </Tooltip>
          </div>
        </aside>

        <main
          className="relative flex-1 bg-background text-foreground"
          style={{
            paddingTop: "var(--topbar-height)",
            paddingLeft: "var(--sidebar-width)",
          }}
        >
          <Authorized>
            <SessionExpiryBanner />
          </Authorized>
          <div className="w-full h-full overflow-y-auto overflow-x-hidden">{children}</div>
        </main>
      </div>
    </Fragment>
  );
};

interface BaseLayerInfo {
  id: string;
  name: string;
  description: string;
}

interface LayersSheetProps {
  baseLayers: BaseLayerInfo[];
  selectedBaseLayerId: string;
  changeBaseLayer: (index: number) => void;
  hasAccessToLayer: (layer: LayerInfo) => boolean;
}

const LayersSheet: React.FC<LayersSheetProps> = ({
  baseLayers,
  selectedBaseLayerId,
  changeBaseLayer,
  hasAccessToLayer,
}) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => setIsAnimating(true), 10);
  };

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => setOpen(false), 300);
  };

  const openSheet = () => handleOpen();
  const closeSheet = () => handleClose();

  return (
    <Sheet open={open} onOpenChange={(isOpen) => (isOpen ? openSheet() : closeSheet())}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SheetTrigger asChild>
            <button
              type="button"
              data-tour="layers"
              style={
                {
                  "--sidebar-color": "#10b981",
                  "--sidebar-bg": "#d1fae5",
                } as React.CSSProperties
              }
              className={cn(
                "cursor-pointer w-11 h-11 rounded-button flex items-center justify-center transition-all duration-normal relative group",
                "border-2 border-transparent hover:bg-muted"
              )}
            >
              <Layers className="cursor-pointer w-5 h-5 text-muted-foreground group-hover:text-foreground" />
            </button>
          </SheetTrigger>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>Layers</p>
        </TooltipContent>
      </Tooltip>
      <SheetContent
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--topbar-height": TOPBAR_HEIGHT,
          } as React.CSSProperties
        }
        side="left"
        className={cn(
          "p-0 h-[calc(100%-var(--topbar-height))] w-[320px] mt-[var(--topbar-height)] ml-[var(--sidebar-width)]",
          "transition-transform duration-300 ease-in-out bg-card text-foreground",
          isAnimating ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-muted/50">
          <SheetTitle className="font-semibold text-base flex items-center gap-2.5 text-foreground">
            <div className="p-1.5 rounded-lg bg-foreground">
              <Layers className="size-4 text-background" />
            </div>
            {t('mapLayers.title')}
          </SheetTitle>
          <p className="text-xs text-muted-foreground mt-1.5">
            {t('mapLayers.description')}
          </p>
        </div>

        <div className="relative overflow-y-auto no-scrollbar h-[calc(100%-80px)] px-4 py-4">
          {/* Base Layers Section */}
          <div className="relative">
            <Accordion type="single" collapsible defaultValue="base-layers">
              <AccordionItem value="base-layers" className="border-none">
                <AccordionTrigger className="hover:no-underline py-2 px-3 rounded-lg hover:bg-muted transition-colors">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <div className="p-1 rounded bg-muted">
                      <MapIcon className="size-3.5 text-muted-foreground" />
                    </div>
                    {t('mapLayers.baseLayers.title')}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-0">
                  <p className="text-xs text-muted-foreground px-1 mb-3">
                    {t('mapLayers.baseLayers.description')}
                  </p>
                  <RadioGroup className="gap-2" value={selectedBaseLayerId} onValueChange={(val) => {
                    const idx = baseLayers.findIndex((l) => l.id === val);
                    if (idx >= 0) changeBaseLayer(idx);
                  }}>
                    {baseLayers.map((layer) => (
                      <BaseLayerOption
                        key={layer.id}
                        layer={layer}
                      />
                    ))}
                  </RadioGroup>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          <Separator className="my-4 bg-border" />

          {/* Data Layers Section */}
          <div className="relative">
            <div className="flex items-center gap-2 mb-3 px-1">
              <div className="p-1 rounded bg-muted">
                <Layers className="size-3.5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-foreground">{t('mapLayers.dataLayers.title')}</span>
            </div>
            <div className="space-y-2">
              {layers.map((layer) => (
                <LayerOption key={layer.id} layer={layer} hasAccess={hasAccessToLayer(layer)} />
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
interface BaseLayerOptionProps {
  layer: BaseLayerInfo;
}

const BaseLayerOption: React.FC<BaseLayerOptionProps> = ({ layer }) => {
  const { id, name } = layer;
  const { t } = useTranslation();

  // Map layer ID to translation key
  const getLayerDescription = (layerId: string) => {
    const descriptionMap: Record<string, string> = {
      'osm_standard': t('mapLayers.baseLayers.osmStandard'),
      'osm_humanitarian': t('mapLayers.baseLayers.osmHumanitarian'),
      'carto_positron': t('mapLayers.baseLayers.cartoPositron'),
      'carto_dark': t('mapLayers.baseLayers.cartoDark'),
      'carto_voyager': t('mapLayers.baseLayers.cartoVoyager'),
      'opentopomap': t('mapLayers.baseLayers.openTopoMap'),
      'maplibre_3d': t('mapLayers.baseLayers.maplibre3d', '3D buildings on satellite imagery'),
    };
    return descriptionMap[layerId] || layer.description;
  };

  return (
    <label
      htmlFor={id}
      className="group border border-border has-data-[state=checked]:border-foreground has-data-[state=checked]:bg-muted relative flex w-full items-start gap-3 rounded-xl p-3 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer hover:border-muted-foreground text-left"
    >
      <RadioGroupItem
        value={id}
        id={id}
        aria-describedby={`${id}-description`}
        className="order-1 mt-0.5 cursor-pointer border-muted-foreground data-[state=checked]:border-foreground data-[state=checked]:bg-foreground"
      />
      <div className="grid grow gap-1">
        <Label htmlFor={id} className="text-sm font-medium text-foreground cursor-pointer">
          {name}
        </Label>
        <p id={`${id}-description`} className="text-muted-foreground text-xs leading-relaxed">
          {getLayerDescription(id)}
        </p>
      </div>
    </label>
  );
};

interface LayerOptionProps {
  layer: LayerInfo;
  hasAccess: boolean;
}

const LayerOption: React.FC<LayerOptionProps> = ({ layer, hasAccess }) => {
  const { id, name, color, enabled, icon: LayerIcon } = layer;
  const { t } = useTranslation();

  // Map layer ID to translation key
  const getLayerDescription = (layerId: string) => {
    const descriptionMap: Record<string, string> = {
      'enerplanet_simulation_final': t('mapLayers.dataLayers.energySimulation'),
    };
    return descriptionMap[layerId] || layer.description;
  };

  return (
    <div className="relative">
      <div
        style={{ "--layer-color": color } as React.CSSProperties}
        className={cn(
          "group border border-border cursor-pointer relative flex w-full items-center gap-3 rounded-xl p-3 shadow-sm hover:shadow-md transition-all duration-200",
          "hover:border-muted-foreground",
          "has-data-[state=checked]:border-foreground has-data-[state=checked]:bg-muted",
          !hasAccess && "opacity-50 pointer-events-none"
        )}
      >
        {/* Layer Icon */}
        <div className="p-2 rounded-lg bg-muted group-hover:bg-accent transition-colors">
          <LayerIcon className="size-4 text-foreground" />
        </div>

        {/* Layer Info */}
        <div className="flex-1 min-w-0">
          <Label htmlFor={id} className="text-sm font-medium text-foreground cursor-pointer block">
            {name}
          </Label>
          <p
            id={`${id}-description`}
            className="text-muted-foreground text-xs mt-0.5 leading-relaxed truncate"
          >
            {getLayerDescription(id)}
          </p>
          {!hasAccess && (
            <span className="text-amber-600 dark:text-amber-400 text-xs mt-1 flex items-center gap-1">
              <svg className="size-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
              Requires {layer.accessLevel.replace("_", " ")} access
            </span>
          )}
        </div>

        {/* Toggle Switch */}
        <Switch
          id={id}
          className={cn("h-5 w-9 shrink-0", "data-[state=checked]:bg-foreground cursor-pointer")}
          aria-describedby={`${id}-description`}
          {...(enabled && { checked: enabled })}
        />
      </div>
    </div>
  );
};
