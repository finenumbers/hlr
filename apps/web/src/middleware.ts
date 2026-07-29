import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function buildContentSecurityPolicy(publicApiUrl: string): string {
  const connectSrc = ["'self'", publicApiUrl].join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
  ].join('; ');
}

function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  const host = trimmed.replace(/^\/\//, '');
  const isLocal =
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:');
  return `${isLocal ? 'http' : 'https'}://${host}`;
}

export function middleware(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const publicApiUrl = normalizePublicUrl(
    process.env.PUBLIC_API_URL ?? 'http://localhost:3001',
  );

  response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(publicApiUrl));
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.png|branding/).*)'],
};
