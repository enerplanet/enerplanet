import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";

export type PageMessageSeverity = "success" | "error" | "warning" | "info";

interface PageMessage {
	id: number;
	message: string;
	severity: PageMessageSeverity;
}

interface PageMessagesContextValue {
	current: PageMessage | null;
	waiting: number;
	show: (message: string, severity: PageMessageSeverity) => void;
	dismiss: () => void;
}

const PageMessagesContext = createContext<PageMessagesContextValue | null>(null);

const AUTO_HIDE_MS = 5000;

let nextId = 1;

/** Holds the page messages of every page inside AppLayout as one queue. */
export const PageMessagesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [queue, setQueue] = useState<PageMessage[]>([]);

	const show = useCallback((message: string, severity: PageMessageSeverity) => {
		setQueue(prev => [...prev, { id: nextId++, message, severity }]);
	}, []);

	const dismiss = useCallback(() => {
		setQueue(prev => prev.slice(1));
	}, []);

	const value = useMemo<PageMessagesContextValue>(() => ({
		current: queue.at(0) ?? null,
		waiting: Math.max(queue.length - 1, 0),
		show,
		dismiss,
	}), [queue, show, dismiss]);

	return <PageMessagesContext.Provider value={value}>{children}</PageMessagesContext.Provider>;
};

/** Access to the page message queue; only valid inside PageMessagesProvider. */
export const usePageMessages = (): PageMessagesContextValue => {
	const ctx = useContext(PageMessagesContext);
	if (!ctx) {
		throw new Error("usePageMessages must be used inside PageMessagesProvider (AppLayout)");
	}
	return ctx;
};

const STYLES: Record<PageMessageSeverity, string> = {
	success: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200",
	error: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-200",
	warning: "bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200",
	info: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-200",
};

const ICONS: Record<PageMessageSeverity, React.ReactNode> = {
	success: <CheckCircle className="w-4 h-4 shrink-0" />,
	error: <XCircle className="w-4 h-4 shrink-0" />,
	warning: <AlertTriangle className="w-4 h-4 shrink-0" />,
	info: <Info className="w-4 h-4 shrink-0" />,
};

/**
 * The current page message, shown on one line in the header next to the bell.
 * Errors stay until closed; other messages close after AUTO_HIDE_MS.
 */
export const HeaderMessage: React.FC = () => {
	const { current, waiting, dismiss } = usePageMessages();

	useEffect(() => {
		if (!current || current.severity === "error") return;
		const timer = setTimeout(dismiss, AUTO_HIDE_MS);
		return () => clearTimeout(timer);
	}, [current, dismiss]);

	if (!current) return null;

	return (
		<div
			key={current.id}
			role={current.severity === "error" ? "alert" : "status"}
			className={`md-drop-in flex items-center gap-2 min-w-0 max-w-xl h-8 px-3 rounded-md border text-sm ${STYLES[current.severity]}`}
		>
			{ICONS[current.severity]}
			<span className="truncate font-medium" title={current.message}>{current.message}</span>
			{waiting > 0 && <span className="shrink-0 text-xs opacity-70">+{waiting}</span>}
			<button
				type="button"
				onClick={dismiss}
				aria-label="Close"
				className="shrink-0 hover:opacity-70 transition-opacity"
			>
				<X className="w-3.5 h-3.5" />
			</button>
		</div>
	);
};
