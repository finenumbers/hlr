export type PublicRuntimeEnv = {
  apiUrl: string;
};

declare global {
  interface Window {
    __FN_PUBLIC__?: PublicRuntimeEnv;
  }
}

const FALLBACK_API_URL = 'http://localhost:3001';

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '');
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
