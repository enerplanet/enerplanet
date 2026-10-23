import React, { useState } from "react";
import { Bell, Cog, LayoutGrid, Settings, User } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PageHeader } from "@/components/ui/PageHeader";
import { CARD_CLASS, PAGE_SHELL_CLASS } from "@/components/ui/toolbar";
import ProfileSettings from "@/features/settings/ProfileSettings";
import MapSettings from "@/features/settings/MapLocationSettings";
import NotificationSettings from "@/features/settings/NotificationSettings";
import LanguageSettings from "@/features/settings/LanguageSettings";
import NotificationManagement from "@/features/settings/NotificationManagement";
import PolygonLimitsSettings from "@/features/settings/PolygonLimitsSettings";
import RegionManagement from "@/features/settings/RegionManagement";
import { SettingsRow } from "@/features/settings/SettingsRow";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";

type TabKey = "profile" | "general" | "notifications" | "advanced";

/** The user's profile and preferences on one page, one tab per group; Advanced is for experts. */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  useDocumentTitle(t("settings.title"));
  const isExpert = useAuthStore((state) => state.user?.access_level === "expert");
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  const tabs: { key: TabKey; label: string; icon: typeof User }[] = [
    { key: "profile", label: t("settings.tabs.profile"), icon: User },
    { key: "general", label: t("settings.tabs.general"), icon: LayoutGrid },
    { key: "notifications", label: t("settings.tabs.notifications"), icon: Bell },
    ...(isExpert ? [{ key: "advanced" as const, label: t("settings.tabs.advanced"), icon: Cog }] : []),
  ];

  return (
    <div className={PAGE_SHELL_CLASS}>
      <PageHeader icon={Settings} title={t("settings.title")} subtitle={t("settings.subtitle")} />

      <div className={cn("md-rise overflow-hidden", CARD_CLASS)}>
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border bg-muted px-2 pt-2" role="tablist">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "-mb-px flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border border-transparent px-3 py-2 text-sm font-medium transition-colors",
                activeTab === key
                  ? "border-border border-b-card bg-card text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        <div key={activeTab} className="md-fade-in" role="tabpanel">
          {activeTab === "profile" && <ProfileSettings />}

          {activeTab === "general" && (
            <>
              <SettingsRow title={t("settings.language.title")} description={t("settings.language.subtitle")}>
                <LanguageSettings />
              </SettingsRow>
              <SettingsRow title={t("settings.mapLocation.title")} description={t("settings.mapLocation.subtitle")}>
                <div className="max-w-md">
                  <MapSettings />
                </div>
              </SettingsRow>
            </>
          )}

          {activeTab === "notifications" && (
            <>
              <SettingsRow title={t("settings.notifications.title")} description={t("settings.notifications.subtitle")}>
                <NotificationSettings />
              </SettingsRow>
              {isExpert && (
                <SettingsRow title={t("settings.sendNotification.title")} description={t("settings.sendNotification.subtitle")}>
                  <NotificationManagement />
                </SettingsRow>
              )}
            </>
          )}

          {activeTab === "advanced" && isExpert && (
            <>
              <SettingsRow title={t("settings.polygonLimits.title")} description={t("settings.polygonLimits.subtitle")}>
                <PolygonLimitsSettings />
              </SettingsRow>
              <SettingsRow title="Cached Regions" description="Pipeline Data Management">
                <RegionManagement />
              </SettingsRow>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
