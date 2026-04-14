import type { AxiosResponse } from 'axios';

const RESERVED_WINDOWS_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const DISPOSITION_FILENAME_STAR_REGEX = /filename\*\s*=\s*([^;]+)/i;
const DISPOSITION_FILENAME_REGEX = /filename\s*=\s*([^;]+)/i;
const DISPOSITION_CHARSET_PREFIX_REGEX = /^[A-Za-z0-9!#$&+\-.^_`|~]+''/;
const MAX_FILENAME_LENGTH = 150;

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function truncateKeepingExtension(filename: string, maxLength: number): string {
  if (filename.length <= maxLength) {
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return filename.slice(0, maxLength);
  }

  const extension = filename.slice(dotIndex);
  const baseLength = maxLength - extension.length;
  if (baseLength <= 0) {
    return filename.slice(0, maxLength);
  }

  return `${filename.slice(0, baseLength)}${extension}`;
}

function stripControlChars(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isControl = (code >= 0 && code <= 31) || code === 127;
    if (!isControl) {
      out += value[i];
    }
  }
  return out;
}

function getHeaderValue(headers: unknown, targetHeader: string): string | null {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const normalizedTarget = targetHeader.toLowerCase();
  const entries = Object.entries(headers as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key.toLowerCase() !== normalizedTarget) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(', ');
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value == null) {
      return null;
    }
    return String(value);
  }

  return null;
}

function decodeRfc5987Filename(value: string): string | null {
  const stripped = stripQuotes(value.trim());
  const encoded = stripped.replace(DISPOSITION_CHARSET_PREFIX_REGEX, '');
  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function extractFilenameFromContentDisposition(header: string | null | undefined): string | null {
  const contentDisposition = String(header ?? '').trim();
  if (!contentDisposition) {
    return null;
  }

  const filenameStarMatch = DISPOSITION_FILENAME_STAR_REGEX.exec(contentDisposition);
  if (filenameStarMatch?.[1]) {
    const decoded = decodeRfc5987Filename(filenameStarMatch[1]);
    if (decoded) {
      return decoded;
    }
  }

  const filenameMatch = DISPOSITION_FILENAME_REGEX.exec(contentDisposition);
  if (!filenameMatch?.[1]) {
    return null;
  }

  const filename = stripQuotes(filenameMatch[1].trim());
  return filename || null;
}

function sanitizeDownloadFilename(filename: string | null | undefined, fallback: string): string {
  const initial = String(filename ?? '').trim() || fallback;
  let sanitized = stripControlChars(initial)
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');

  if (!sanitized) {
    sanitized = fallback;
  }

  if (RESERVED_WINDOWS_FILE_NAMES.test(sanitized)) {
    sanitized = `_${sanitized}`;
  }

  return truncateKeepingExtension(sanitized, MAX_FILENAME_LENGTH);
}

export function downloadBlobResponse(response: AxiosResponse<Blob>, fallbackFilename: string): string {
  const contentDisposition = getHeaderValue(response.headers, 'content-disposition');
  const parsedFilename = extractFilenameFromContentDisposition(contentDisposition);
  const filename = sanitizeDownloadFilename(parsedFilename, fallbackFilename);

  const blob = response.data;
  const url = globalThis.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL(url);

  return filename;
}
