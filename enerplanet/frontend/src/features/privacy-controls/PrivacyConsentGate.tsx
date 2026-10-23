import React, { useEffect, useState } from "react";
import axios from "@/lib/axios";
import { useAuth } from "@/providers/auth-provider";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import { PrivacyConsentDialog } from "./PrivacyConsentDialog";

/** Onboarding and the product tour wait for this event before they start. */
const PRIVACY_ACCEPTED_EVENT = "privacy-accepted";

/** Asks a signed-in user for the data and privacy consent until they accept it, once per page load. */
export const PrivacyConsentGate: React.FC = () => {
  const { user } = useAuth();
  const { showError } = useNotification();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) {
      setOpen(false);
      return;
    }
    let cancelled = false;
    axios
      .get("/settings")
      .then(({ data }) => { if (!cancelled) setOpen(!data?.data?.privacy_accepted); })
      // A user without settings yet has not accepted.
      .catch(() => { if (!cancelled) setOpen(true); });
    return () => { cancelled = true; };
  }, [user]);

  const save = async (accepted: boolean) => {
    try {
      await axios.put("/settings/privacy-accepted", { accepted });
    } catch (err) {
      showError(`Could not save your privacy choice: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setOpen(false);
    if (accepted) globalThis.dispatchEvent(new CustomEvent(PRIVACY_ACCEPTED_EVENT));
  };

  return (
    <PrivacyConsentDialog
      isOpen={open}
      onAccept={() => save(true)}
      onDeny={() => save(false)}
      onClose={() => setOpen(false)}
    />
  );
};
