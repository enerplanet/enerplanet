import React from "react";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useToastStore, type Toast, type ToastSeverity } from "./toastStore";

/** Toasts on screen at once; older ones stay in the store until they close. */
const VISIBLE_TOASTS = 3;

const STYLES: Record<ToastSeverity, string> = {
	success: "border-green-200 dark:border-green-800",
	error: "border-red-300 dark:border-red-800",
	warning: "border-yellow-300 dark:border-yellow-800",
	info: "border-blue-200 dark:border-blue-800",
};

const ICONS: Record<ToastSeverity, React.ReactNode> = {
	success: <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />,
	error: <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />,
	warning: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />,
	info: <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />,
};

/** One toast with its close button; the store also closes it on its own. */
const ToastItem: React.FC<{ toast: Toast }> = ({ toast }) => {
	const { t } = useTranslation();
	const dismiss = useToastStore((s) => s.dismiss);

	return (
		<div
			role={toast.severity === "error" ? "alert" : "status"}
			className={`md-rise pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm text-foreground shadow-lg ${STYLES[toast.severity]}`}
		>
			{ICONS[toast.severity]}
			<div className="min-w-0 flex-1">
				{toast.title && <p className="font-semibold">{toast.title}</p>}
				<p className="break-words text-muted-foreground">{toast.message}</p>
			</div>
			<button
				type="button"
				onClick={() => dismiss(toast.id)}
				aria-label={t("common.close", "Close")}
				className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
			>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
};

/**
 * Messages and notifications in the bottom-left corner of the page, next to the
 * bell in the rail. New toasts appear at the bottom and push older ones up.
 */
export const ToastStack: React.FC = () => {
	const toasts = useToastStore((s) => s.toasts);
	const lifted = useToastStore((s) => s.lifted);
	const shown = toasts.slice(-VISIBLE_TOASTS);

	return (
		<div
			className="pointer-events-none fixed z-[60] flex w-[22rem] max-w-[calc(100vw-var(--sidebar-width)-2rem)] flex-col gap-2"
			style={{ left: "calc(var(--sidebar-width) + 1rem)", bottom: lifted ? "6.5rem" : "1rem" }}
		>
			{shown.map((toast) => (
				<ToastItem key={toast.id} toast={toast} />
			))}
		</div>
	);
};
