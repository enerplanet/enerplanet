/** Postcodes compare without spaces, so "1234 AB" and "1234AB" are the same. */
function compact(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
}

/**
 * regionMatch reports whether a region matches a search query: by its name or
 * country (substring), or by one of its postcodes (prefix). `postcode` is the
 * first postcode that matched, for showing why the region is listed.
 */
export function regionMatch(
    region: { name: string; postcodes?: string[] },
    country: string,
    query: string,
): { matches: boolean; postcode?: string } {
    const q = query.trim().toLowerCase();
    if (!q || region.name.toLowerCase().includes(q) || country.toLowerCase().includes(q)) {
        return { matches: true };
    }
    const qc = compact(q);
    const postcode = region.postcodes?.find(p => compact(p).startsWith(qc));
    return postcode ? { matches: true, postcode } : { matches: false };
}
