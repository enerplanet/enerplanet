import React, { useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import axios from "@/lib/axios";
import { useTranslation } from "@spatialhub/i18n";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import { ApiTokensDialog } from "@/features/api-tokens/ApiTokensDialog";
import { PRIMARY_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS } from "@/components/ui/toolbar";
import { SettingsRow } from "@/features/settings/SettingsRow";
import {
  OverviewStatsCards,
  AccessPermissionsCard,
} from "@/features/admin-dashboard/OverviewPanel";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  access_level: string;
}

const INPUT_CLASS =
  "w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent transition-colors bg-background dark:bg-input text-foreground placeholder-muted-foreground";

const apiError = (err: unknown, fallback: string): string =>
  (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback;

/** The user's name, email, access level and API tokens, as rows of the settings page. */
const ProfileSettings: React.FC = () => {
  const { t } = useTranslation();
  const { showSuccess, showError } = useNotification();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [tokensOpen, setTokensOpen] = useState(false);

  useEffect(() => {
    axios
      .get("/users/profile")
      .then((response) => {
        const data: ProfileData | undefined = response.data.data;
        if (data) {
          setProfile(data);
          setName(data.name);
        }
      })
      .catch((err: unknown) => showError(apiError(err, t("profile.notifications.failedToLoad"))));
  }, [showError, t]);

  const saveName = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await axios.put("/users/profile", { name });
      setProfile((p) => (p ? { ...p, name } : p));
      showSuccess(t("profile.notifications.updated"));
    } catch (err: unknown) {
      showError(apiError(err, t("profile.notifications.failedToUpdate")));
    } finally {
      setIsSaving(false);
    }
  };

  if (!profile) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("profile.loadingProfile")}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        <OverviewStatsCards />
        <AccessPermissionsCard />
      </div>
      <SettingsRow title={t("profile.fields.fullName")}>
        <form onSubmit={saveName} className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("profile.placeholders.fullName")}
            className={INPUT_CLASS}
          />
          <button type="submit" disabled={isSaving || name.trim() === "" || name === profile.name} className={PRIMARY_BUTTON_CLASS}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("common.save")}
          </button>
        </form>
      </SettingsRow>
      <SettingsRow title={t("profile.fields.email")} description={t("profile.readOnly")}>
        <p className="text-sm text-foreground">{profile.email}</p>
      </SettingsRow>
      <SettingsRow title={t("apiTokens.title", "API Tokens")} description={t("apiTokens.profileDescription", "Create and revoke your API tokens to access your models and results from scripts or other apps.")}>
        <button type="button" onClick={() => setTokensOpen(true)} className={TOOLBAR_BUTTON_CLASS}>
          <KeyRound className="h-4 w-4" />
          {t("apiTokens.manageOwn", "Manage my API tokens")}
        </button>
      </SettingsRow>
      {tokensOpen && <ApiTokensDialog user={profile} personal isOpen onClose={() => setTokensOpen(false)} />}
    </>
  );
};

export default ProfileSettings;
