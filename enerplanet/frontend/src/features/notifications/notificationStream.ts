import { config } from '@/configuration/app';
import { useAuthStore } from '@/store/auth-store';

/**
 * One EventSource per tab for /notifications/stream, shared by every
 * subscriber. Each open stream holds one of the browser's six HTTP/1.1
 * connections to the host, so a second stream per tab starves other requests.
 */
type Listener = (event: MessageEvent) => void;

const RECONNECT_DELAY_MS = 5000;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function streamUrl(): string {
  const base = config.api.baseUrl || '/api';
  return `${base.endsWith('/') ? base.slice(0, -1) : base}/notifications/stream`;
}

function close(): void {
  source?.close();
  source = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function open(): void {
  if (source || reconnectTimer || !useAuthStore.getState().user) return;
  source = new EventSource(streamUrl(), { withCredentials: true });
  source.addEventListener('notification', (event) => {
    listeners.forEach((listener) => listener(event as MessageEvent));
  });
  source.onerror = () => {
    close();
    if (listeners.size === 0 || !useAuthStore.getState().user) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, RECONNECT_DELAY_MS);
  };
}

/** Calls listener for each notification event; returns the unsubscribe function. */
export function subscribeNotifications(listener: Listener): () => void {
  listeners.add(listener);
  open();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) close();
  };
}
