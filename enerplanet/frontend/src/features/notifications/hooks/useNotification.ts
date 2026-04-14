import { useState, useCallback } from 'react';

type NotificationSeverity = "success" | "error" | "warning" | "info";

interface NotificationState {
    open: boolean;
    message: string;
    severity: NotificationSeverity;
}

/** Hook to manage notification state and helpers (success, error, warning, info). */
export const useNotification = () => {
    const [notification, setNotification] = useState<NotificationState>({
        open: false,
        message: "",
        severity: "success",
    });

    /** Show a notification with message and severity */
    const show = useCallback((message: string, severity: NotificationSeverity = "info") => {
        setNotification({ open: true, message, severity });
    }, []);

    /** Convenience helpers */
    const showSuccess = useCallback((message: string) => {
        show(message, "success");
    }, [show]);

    const showError = useCallback((message: string) => {
        show(message, "error");
    }, [show]);

    const showWarning = useCallback((message: string) => {
        show(message, "warning");
    }, [show]);

    const showInfo = useCallback((message: string) => {
        show(message, "info");
    }, [show]);

    /** Hide the current notification */
    const hide = useCallback(() => {
        setNotification(prev => ({ ...prev, open: false }));
    }, []);

    return {
        notification,
        show,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        hide,
        setNotification, // For backwards compatibility
    };
};
