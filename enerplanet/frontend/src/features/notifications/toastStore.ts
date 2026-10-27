import { create } from "zustand";

export type ToastSeverity = "success" | "error" | "warning" | "info";

/** One message in the toast stack: a page message or an incoming notification. */
export interface Toast {
	id: number;
	severity: ToastSeverity;
	message: string;
	title?: string;
}

interface ToastState {
	toasts: Toast[];
	/** Raises the stack above a bar at the bottom of the page, such as the map action bar. */
	lifted: boolean;
	push: (toast: Omit<Toast, "id">) => void;
	dismiss: (id: number) => void;
	/** Closes the oldest toast. */
	dismissOldest: () => void;
	setLifted: (lifted: boolean) => void;
}

/** Toasts close this long after they arrive, shown or not; errors stay twice as long. Notifications stay in the bell. */
const AUTO_HIDE_MS = 5000;
const ERROR_AUTO_HIDE_MS = 10000;

let nextId = 1;

/** All toasts of the app, oldest first. */
export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	lifted: false,
	push: (toast) => {
		const id = nextId++;
		set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
		setTimeout(() => get().dismiss(id), toast.severity === "error" ? ERROR_AUTO_HIDE_MS : AUTO_HIDE_MS);
	},
	dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
	dismissOldest: () => set((s) => ({ toasts: s.toasts.slice(1) })),
	setLifted: (lifted) => set({ lifted }),
}));
