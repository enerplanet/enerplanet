import { useMemo, useEffect } from "react";
import { useAuth } from "@/providers/auth-provider";
import { useLocation, useNavigate } from "react-router-dom";
import OnboardingWizard from "@/features/onboarding/OnboardingWizard";
import { useOnboarding } from "@/features/onboarding/hooks/useOnboarding";
import { closeNotificationStream } from "@/features/notifications/hooks/useNotificationsQuery";
import { ToastStack } from "@/features/notifications/ToastStack";
import { NotificationDropdown } from "@/components/ui/NotificationDropdown";
import { useTranslation } from "@spatialhub/i18n";

import {
  LogOut,
  Settings,
  User,
  BookOpen,
  GraduationCap,
  MessageSquareText,
  HousePlug,
  MapPinHouse,
  GitCompareArrows,
  LayoutGrid,
  LucideIcon,
  Cpu,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Button,
} from "@spatialhub/ui";
import SidebarButton from "@/components/ui/SidebarButton";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useProductTour } from "@/features/guided-tour/hooks/useProductTour";
import { Authorized } from "@/middleware/authorized";
import { useAuthStore } from "@/store/auth-store";
import { SessionTimer } from "@/components/ui/SessionTimer";
import { SessionExpiryBanner } from "@/components/ui/SessionExpiryBanner";

interface AppLayoutProps {
  children: React.ReactNode;
}

// Constants
const SIDEBAR_WIDTH = "4.5rem";
// The app has no header bar; pages start at the top of the window.
const TOPBAR_HEIGHT = "0px";
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

  // A saved base map that is not in the list falls back to the first one.
  useEffect(() => {
    if (!baseLayers.some((l) => l.id === selectedBaseLayerId)) {
      setSelectedBaseLayerId(baseLayers[0].id);
    }
  }, [selectedBaseLayerId, baseLayers, setSelectedBaseLayerId]);

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
    <>
      <OnboardingWizard isOpen={showOnboarding} onComplete={completeOnboarding} />

      <div
        className="relative flex h-full w-full overflow-hidden bg-background text-foreground"
        style={cssVariables}
      >

        <aside className="fixed left-0 bottom-0 bg-card border-r border-border shadow-lg z-[51] w-[var(--sidebar-width)] top-[var(--topbar-height)]">
          <div className="flex flex-col items-center gap-2 py-4">
            <a
              href="/app/model-dashboard"
              onClick={(e) => { if (!e.ctrlKey && !e.metaKey && e.button === 0) { e.preventDefault(); navigate("/app/model-dashboard"); } }}
              aria-label="EnerPlanET"
              className="mb-3 rounded-lg p-1 transition-opacity hover:opacity-80"
            >
              <img src="/brand/enerplanet-mark-green-outline.svg" alt="EnerPlanET" className="h-10 w-auto dark:hidden" />
              <img src="/brand/enerplanet-mark-green-dark-outline.svg" alt="EnerPlanET" className="hidden h-10 w-auto dark:block" />
            </a>
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

          </div>

          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex flex-col items-center gap-3 text-center">
            <Authorized>
              <NotificationDropdown />
            </Authorized>
            {!user && (
              <div className="flex flex-col items-center gap-3">
                <ThemeToggle />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      onClick={navigationHandlers.login}
                      className="cursor-pointer rounded-full size-7 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 hover:from-gray-200 hover:to-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700 border border-gray-200 dark:border-gray-600 shadow-sm transition-all duration-200 hover:shadow-md group"
                    >
                      <svg
                        className="w-3.5 h-3.5 text-gray-700 dark:text-gray-300 group-hover:scale-110 transition-transform"
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
              </div>
            )}
            {/* Profile avatar + dropdown (session timer, theme, menu). Lives at
                the bottom of the left rail; the menu opens to the right of it. */}
            <Authorized>
              <div className="relative" data-tour="profile">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer rounded-full size-11 flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 hover:from-gray-200 hover:to-gray-300 dark:hover:from-gray-600 dark:hover:to-gray-700 border border-gray-200 dark:border-gray-600 shadow-sm transition-all duration-200 hover:shadow-md group"
                      title={t("common.tooltips.profile")}
                    >
                      <div className="text-base font-semibold text-gray-700 dark:text-gray-200 group-hover:scale-105 transition-transform">
                        {getUserInitial()}
                      </div>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-52 z-[60]" side="right" align="end" sideOffset={8}>
                    {/* Session Timer at top of dropdown */}
                    <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-700">
                      <SessionTimer warningThreshold={5} compact />
                    </div>
                    {/* Theme Toggle */}
                    <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                      <span className="text-sm text-foreground">{t("common.tooltips.theme")}</span>
                      <ThemeToggle />
                    </div>
                    <DropdownMenuItem className="cursor-pointer" onClick={navigationHandlers.dashboard}>
                      <LayoutGrid className="w-4 h-4" />
                      Dashboard
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={navigationHandlers.documentation}>
                      <BookOpen className="w-4 h-4" />
                      {t("common.tooltips.documentation")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={handleSmartRestartTour}>
                      <GraduationCap className="w-4 h-4" />
                      {t("common.tooltips.restartTour")}
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={() => navigationHandlers.feedback()}>
                      <MessageSquareText className="w-4 h-4" />
                      {t("common.tooltips.feedback")}
                    </DropdownMenuItem>
                    <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
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

          </div>
        </aside>

        <ToastStack />

        <main
          className="relative min-w-0 flex-1 bg-background text-foreground"
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
    </>
  );
};
