import { useCallback } from 'react';
import { usePageMessages, type PageMessageSeverity } from '@/features/notifications/pageMessages';

interface NotificationState {
    open: boolean;
    message: string;
    severity: PageMessageSeverity;
}

/** Shows page messages (success, error, warning, info) in the header next to the bell. */
export const useNotification = () => {
    const { show, dismiss } = usePageMessages();

    const showSuccess = useCallback((message: string) => show(message, "success"), [show]);
    const showError = useCallback((message: string) => show(message, "error"), [show]);
    const showWarning = useCallback((message: string) => show(message, "warning"), [show]);
    const showInfo = useCallback((message: string) => show(message, "info"), [show]);

    /** Shows the message when `open`, otherwise closes the current one. */
    const setNotification = useCallback((state: NotificationState) => {
        if (state.open) {
            show(state.message, state.severity);
        } else {
            dismiss();
        }
    }, [show, dismiss]);

    return {
        show,
        showSuccess,
        showError,
        showWarning,
        showInfo,
        hide: dismiss,
        setNotification,
    };
};
