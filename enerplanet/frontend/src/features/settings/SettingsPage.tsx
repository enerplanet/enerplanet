import React, { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, FlaskConical, LayoutGrid, User } from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import SectionShell from "@/components/ui/SectionShell";
import ProfileSettings from "@/features/settings/ProfileSettings";
import MapSettings from "@/features/settings/MapLocationSettings";
import NotificationSettings from "@/features/settings/NotificationSettings";
import LanguageSettings from "@/features/settings/LanguageSettings";
import NotificationManagement from "@/features/settings/NotificationManagement";
import ExperimentalFeatures from "@/features/settings/ExperimentalFeatures";
import { SettingsRow } from "@/features/settings/SettingsRow";
import { useFeatureFlag, useFeatureFlagsStore } from "@/features/settings/flags-store";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import type { ShellTab } from "@/components/ui/SectionShell";

type TabKey = "profile" | "general" | "notifications" | "experimental";

interface SettingsPageProps {
  /**
   * Set by the `/app/settings/experimental` route. Opening that URL enables the
   * `experimentalSettings` flag (persisted in localStorage), activates the tab,
   * and rewrites the URL back to `/app/settings` — the URL is a one-shot unlock,
   * not a mode. The tab can then be hidden again with its own toggle, and the
   * same URL unlocks it once more.
   */
  unlockExperimental?: boolean;
}

/** The user's profile and preferences on one page, one tab per group. */
const SettingsPage: React.FC<SettingsPageProps> = ({ unlockExperimental = false }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t("settings.title"));
  const isExpert = useAuthStore((state) => state.user?.access_level === "expert");
  const experimentalEnabled = useFeatureFlag("experimentalSettings");
  const setFlag = useFeatureFlagsStore((state) => state.setFlag);
  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  // Deep link: unlock + land on the tab + clean the URL. A layout effect so the
  // tab is visible on the first painted frame.
  useLayoutEffect(() => {
    if (!unlockExperimental) return;
    setFlag("experimentalSettings", true);
    setActiveTab("experimental");
    navigate("/app/settings", { replace: true });
  }, [unlockExperimental, setFlag, navigate]);

  // Switching the flag off (from inside the panel) closes the tab.
  useEffect(() => {
    if (!experimentalEnabled && activeTab === "experimental") setActiveTab("profile");
  }, [experimentalEnabled, activeTab]);

  const tabs: ShellTab[] = [
    { key: "profile", label: t("settings.tabs.profile"), icon: <User className="w-5 h-5" /> },
    { key: "general", label: t("settings.tabs.general"), icon: <LayoutGrid className="w-5 h-5" /> },
    { key: "notifications", label: t("settings.tabs.notifications"), icon: <Bell className="w-5 h-5" /> },
    ...(experimentalEnabled
      ? [{ key: "experimental", label: t("settings.tabs.experimental"), icon: <FlaskConical className="w-5 h-5" /> }]
      : []),
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

        {activeTab === "experimental" && <ExperimentalFeatures />}
      </div>
    </SectionShell>
  );
};

export default SettingsPage;
