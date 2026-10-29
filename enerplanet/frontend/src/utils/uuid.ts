/**
 * Generate a UUID that works in both secure (HTTPS) and non-secure (HTTP) contexts.
 * Prefer crypto.randomUUID(), otherwise build RFC4122 v4 from crypto.getRandomValues().
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // RFC4122 version 4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // RFC4122 variant 10xx
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('Secure random UUID generation is not supported in this environment.');
}
