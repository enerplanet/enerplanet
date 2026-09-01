const CARTO_BASEMAP_API_KEY =
  import.meta.env.VITE_CARTO_BASEMAP_API_KEY?.trim() ?? "";

/** Return true only for CARTO's public basemap CDN and its subdomains. */
export function isCartoBasemapUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "cartocdn.com" || hostname.endsWith(".cartocdn.com");
  } catch {
    return false;
  }
}

/** Add the browser-facing CARTO basemap key without changing non-CARTO URLs. */
export function withCartoBasemapKey(
  url: string,
  apiKey: string = CARTO_BASEMAP_API_KEY,
): string {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey || !isCartoBasemapUrl(url) || /[?&]key=/i.test(url)) {
    return url;
  }

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}key=${encodeURIComponent(normalizedKey)}`;
}
