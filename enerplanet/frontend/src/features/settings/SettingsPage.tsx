import React, { useState } from "react";
import { Bell, LayoutGrid, User } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import SectionShell from "@/components/ui/SectionShell";
import ProfileSettings from "@/features/settings/ProfileSettings";
import MapSettings from "@/features/settings/MapLocationSettings";
import NotificationSettings from "@/features/settings/NotificationSettings";
import LanguageSettings from "@/features/settings/LanguageSettings";
import NotificationManagement from "@/features/settings/NotificationManagement";
import { SettingsRow } from "@/features/settings/SettingsRow";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import type { ShellTab } from "@/components/ui/SectionShell";

type TabKey = "profile" | "general" | "notifications";

/** The user's profile and preferences on one page, one tab per group. */
const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  useDocumentTitle(t("settings.title"));
  const isExpert = useAuthStore((state) => state.user?.access_level === "expert");
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  const tabs: ShellTab[] = [
    { key: "profile", label: t("settings.tabs.profile"), icon: <User className="w-5 h-5" /> },
    { key: "general", label: t("settings.tabs.general"), icon: <LayoutGrid className="w-5 h-5" /> },
    { key: "notifications", label: t("settings.tabs.notifications"), icon: <Bell className="w-5 h-5" /> },
  ];

  return (
    <SectionShell
      title={t("settings.title")}
      subtitle={t("settings.subtitle")}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as TabKey)}
    >
      <div key={activeTab} className="md-fade-in space-y-6">
        {activeTab === "profile" && <ProfileSettings />}

        {activeTab === "general" && (
          <>
            <SettingsRow title={t("settings.language.title")} description={t("settings.language.subtitle")}>
              <LanguageSettings />
            </SettingsRow>
            <SettingsRow title={t("settings.mapLocation.title")} description={t("settings.mapLocation.subtitle")}>
              <MapSettings />
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
      </div>
    </SectionShell>
  );
};

export default SettingsPage;
