import { config } from '@/configuration/app';

/**
 * Get CSRF token from cookie
 */
export function getCSRFToken(): string | null {
  const name = 'csrf_token=';
  const decodedCookie = decodeURIComponent(document.cookie);
  const cookies = decodedCookie.split(';');
  
  for (const cookie of cookies) {
    const trimmedCookie = cookie.trim();
    if (trimmedCookie.startsWith(name)) {
      return trimmedCookie.substring(name.length);
    }
  }
  return null;
}

/**
 * Fetch CSRF token from server if not present in cookie
 */
export async function ensureCSRFToken(): Promise<string | null> {
  const existingToken = getCSRFToken();
  if (existingToken) {
    return existingToken;
  }

  try {
    const baseUrl = config.api.baseUrl || '/api';
    const url = `${baseUrl}/csrf-token`;
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
    });
    
    if (response.ok) {
      const data = await response.json();
      return data.csrf_token;
    }
  } catch (error) {
    if (import.meta.env.DEV) console.error('Failed to fetch CSRF token:', error);
  }
  
  return null;
}
