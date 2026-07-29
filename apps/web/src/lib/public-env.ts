export type PublicRuntimeEnv = {
  apiUrl: string;
};

declare global {
  interface Window {
    __FN_PUBLIC__?: PublicRuntimeEnv;
    __FN_PUBLIC_READY__?: Promise<string>;
  }
}

const FALLBACK_API_URL = 'http://localhost:3001';

/** Same rules as @finenumbers/config normalizePublicUrl (kept local for edge/runtime). */
export function normalizePublicUrl(raw: string): string {
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

function isUsableApiUrl(url: string | undefined | null): url is string {
  if (!url?.trim()) return false;
  const normalized = normalizePublicUrl(url);
  if (!normalized) return false;
  // Baked CI default must not win over runtime /runtime-config in the browser.
  if (typeof window !== 'undefined' && normalized === FALLBACK_API_URL) {
    return false;
  }
  return true;
}

/** Synchronous best-effort URL (may be fallback on first client paint). */
export function getPublicApiUrl(): string {
  if (typeof window !== 'undefined' && isUsableApiUrl(window.__FN_PUBLIC__?.apiUrl)) {
    return normalizePublicUrl(window.__FN_PUBLIC__!.apiUrl);
  }

  const fromEnv =
    process.env.PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? FALLBACK_API_URL;
  return normalizePublicUrl(fromEnv);
}

/**
 * Resolve API base URL for browser requests.
 * Prefers inject from dynamic layout; otherwise loads same-origin /runtime-config
 * so Portainer PUBLIC_API_URL is used even when the build baked localhost.
 */
export async function resolvePublicApiUrl(): Promise<string> {
  if (typeof window === 'undefined') {
    return getPublicApiUrl();
  }

  if (isUsableApiUrl(window.__FN_PUBLIC__?.apiUrl)) {
    return normalizePublicUrl(window.__FN_PUBLIC__!.apiUrl);
  }

  if (!window.__FN_PUBLIC_READY__) {
    window.__FN_PUBLIC_READY__ = (async () => {
      try {
        const res = await fetch('/runtime-config', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`runtime-config ${res.status}`);
        }
        const data = (await res.json()) as { apiUrl?: string };
        const apiUrl = isUsableApiUrl(data.apiUrl)
          ? normalizePublicUrl(data.apiUrl)
          : getPublicApiUrl();
        window.__FN_PUBLIC__ = { apiUrl };
        return apiUrl;
      } catch {
        return getPublicApiUrl();
      }
    })();
  }

  return window.__FN_PUBLIC_READY__;
}

export function getPublicRuntimeEnv(): PublicRuntimeEnv {
  return {
    apiUrl: getPublicApiUrl(),
  };
}
