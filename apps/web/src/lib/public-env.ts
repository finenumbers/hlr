export type PublicRuntimeEnv = {
  apiUrl: string;
};

declare global {
  interface Window {
    __FN_PUBLIC__?: PublicRuntimeEnv;
  }
}

const FALLBACK_API_URL = 'http://localhost:3001';

/** Same rules as @finenumbers/config normalizePublicUrl (kept local for edge/runtime). */
function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const host = trimmed.replace(/^\/\//, '');
  const isLocal =
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:');
  return `${isLocal ? 'http' : 'https'}://${host}`;
}

function normalizeUrl(url: string): string {
  return normalizePublicUrl(url);
}

/** API base URL for browser + server. Prefer runtime inject from PUBLIC_API_URL. */
export function getPublicApiUrl(): string {
  if (typeof window !== 'undefined' && window.__FN_PUBLIC__?.apiUrl) {
    return normalizeUrl(window.__FN_PUBLIC__.apiUrl);
  }

  const fromEnv =
    process.env.PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? FALLBACK_API_URL;
  return normalizeUrl(fromEnv);
}

export function getPublicRuntimeEnv(): PublicRuntimeEnv {
  return {
    apiUrl: getPublicApiUrl(),
  };
}
