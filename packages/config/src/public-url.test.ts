import { describe, expect, it } from 'vitest';

import { normalizePublicUrl, resolveCorsOrigins } from './index.js';

describe('normalizePublicUrl', () => {
  it('adds https for bare production hosts', () => {
    expect(normalizePublicUrl('api.hlr.finenumbers.com')).toBe(
      'https://api.hlr.finenumbers.com',
    );
  });

  it('keeps existing scheme', () => {
    expect(normalizePublicUrl('https://api.hlr.finenumbers.com/')).toBe(
      'https://api.hlr.finenumbers.com',
    );
  });

  it('uses http for localhost', () => {
    expect(normalizePublicUrl('localhost:3001')).toBe('http://localhost:3001');
  });
});

describe('resolveCorsOrigins', () => {
  it('normalizes bare CORS_ORIGINS', () => {
    expect(
      resolveCorsOrigins({
        CORS_ORIGINS: 'hlr.finenumbers.com',
        PUBLIC_WEB_URL: 'https://unused.example.com',
      }),
    ).toEqual(['https://hlr.finenumbers.com']);
  });

  it('falls back to PUBLIC_WEB_URL', () => {
    expect(
      resolveCorsOrigins({
        PUBLIC_WEB_URL: 'https://hlr.finenumbers.com',
      }),
    ).toEqual(['https://hlr.finenumbers.com']);
  });
});
