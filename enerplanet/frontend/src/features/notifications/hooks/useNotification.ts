import { useCallback } from 'react';
import { useToastStore, type ToastSeverity } from '@/features/notifications/toastStore';

interface NotificationState {
    open: boolean;
    message: string;
    severity: ToastSeverity;
}

/** Shows page messages (success, error, warning, info) in the toast stack. */
export const useNotification = () => {
    const push = useToastStore((st) => st.push);
    const dismiss = useToastStore((st) => st.dismissOldest);
    const show = useCallback((message: string, severity: ToastSeverity) => push({ message, severity }), [push]);

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
