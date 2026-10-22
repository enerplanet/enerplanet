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

/** Errors stay until closed; other toasts close this long after they arrive, shown or not. */
const AUTO_HIDE_MS = 5000;

let nextId = 1;

/** All toasts of the app, oldest first. */
export const useToastStore = create<ToastState>((set, get) => ({
	toasts: [],
	lifted: false,
	push: (toast) => {
		const id = nextId++;
		set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
		if (toast.severity !== "error") setTimeout(() => get().dismiss(id), AUTO_HIDE_MS);
	},
	dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
	dismissOldest: () => set((s) => ({ toasts: s.toasts.slice(1) })),
	setLifted: (lifted) => set({ lifted }),
}));
