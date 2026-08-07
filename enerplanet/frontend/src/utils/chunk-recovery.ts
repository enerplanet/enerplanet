const CHUNK_RELOAD_KEY_PREFIX = "enerplanet:chunk-reload";

const CHUNK_LOAD_ERROR_PATTERNS = [
	"Failed to fetch dynamically imported module",
	"error loading dynamically imported module",
	"Importing a module script failed",
	"Expected a JavaScript-or-Wasm module script",
	"MIME type of \"text/html\"",
];

export function installChunkLoadRecovery() {
	if (typeof globalThis === "undefined" || typeof window === "undefined") {
		return;
	}

	window.addEventListener("vite:preloadError", (event) => {
		event.preventDefault();
		reloadOnceForCurrentBundle();
	});

	window.addEventListener(
		"error",
		(event) => {
			if (isChunkLoadError(event)) {
				reloadOnceForCurrentBundle();
			}
		},
		true
	);

	window.addEventListener("unhandledrejection", (event) => {
		if (isChunkLoadError(event.reason)) {
			event.preventDefault();
			reloadOnceForCurrentBundle();
		}
	});
}

function reloadOnceForCurrentBundle() {
	const storage = safeSessionStorage();
	const reloadKey = `${CHUNK_RELOAD_KEY_PREFIX}:${currentBundleURL()}`;

	if (storage?.getItem(reloadKey) === "1") {
		return;
	}

	storage?.setItem(reloadKey, "1");
	window.location.reload();
}

function currentBundleURL(): string {
	const currentScript = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
	return currentScript?.src || window.location.pathname;
}

function isChunkLoadError(value: unknown): boolean {
	const message = errorText(value);
	return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function errorText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	if (value instanceof Error) {
		return [value.name, value.message, value.stack].filter(Boolean).join(" ");
	}

	if (value && typeof value === "object") {
		const maybeErrorEvent = value as ErrorEvent;
		return [
			maybeErrorEvent.message,
			errorText(maybeErrorEvent.error),
			maybeErrorEvent.filename,
		]
			.filter(Boolean)
			.join(" ");
	}

	return "";
}

function safeSessionStorage(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		return null;
	}
}
