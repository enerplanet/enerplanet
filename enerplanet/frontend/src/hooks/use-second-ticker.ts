import { useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let tickerId: number | null = null;
let currentTimeMs = Date.now();

const emitTick = () => {
	currentTimeMs = Date.now();
	listeners.forEach((listener) => listener());
};

const startTicker = () => {
	if (typeof window === "undefined" || tickerId !== null) return;
	tickerId = window.setInterval(emitTick, 1000);
};

const stopTickerIfIdle = () => {
	if (listeners.size > 0 || tickerId === null) return;
	window.clearInterval(tickerId);
	tickerId = null;
};

const subscribeTicker = (listener: Listener) => {
	listeners.add(listener);
	if (listeners.size === 1) {
		startTicker();
	}

	return () => {
		listeners.delete(listener);
		stopTickerIfIdle();
	};
};

const subscribeNoop = () => () => {};
const getSnapshot = () => currentTimeMs;

// Shared 1s ticker for timer-heavy UIs (model table timers).
// This avoids creating one setInterval per row.
export const useSecondTicker = (enabled: boolean): number =>
	useSyncExternalStore(enabled ? subscribeTicker : subscribeNoop, getSnapshot, getSnapshot);
