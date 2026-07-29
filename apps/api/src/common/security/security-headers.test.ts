import { describe, expect, it } from 'vitest';

import { buildApiCorsOptions, buildApiHelmetOptions } from './security-headers';

describe('buildApiHelmetOptions', () => {
  it('uses strict CSP and HSTS in production without swagger', () => {
    const opts = buildApiHelmetOptions({
      isProduction: true,
      swaggerUiEnabled: false,
    });
    expect(opts.hsts).toMatchObject({ maxAge: 31_536_000 });
    expect(opts.contentSecurityPolicy).toMatchObject({
      directives: { defaultSrc: ["'none'"] },
    });
    expect(opts.frameguard).toEqual({ action: 'deny' });
  });

  it('disables CSP when swagger UI is on (dev)', () => {
    const opts = buildApiHelmetOptions({
      isProduction: false,
      swaggerUiEnabled: true,
    });
    expect(opts.contentSecurityPolicy).toBe(false);
    expect(opts.hsts).toBe(false);
  });
});

describe('buildApiCorsOptions', () => {
  it('exposes rate-limit headers and restricts methods', () => {
    const opts = buildApiCorsOptions({
      origins: ['https://app.example.com'],
      isProduction: true,
    });
    expect(opts.origin).toEqual(['https://app.example.com']);
    expect(opts.exposedHeaders).toContain('X-RateLimit-Zone');
    expect(opts.methods).not.toContain('TRACE');
    expect(opts.maxAge).toBe(600);
  });
});
