import { describe, expect, it } from 'vitest';

import { isSubmitWritePath, parseSizeToBytes } from './rate-limit-zone';

describe('isSubmitWritePath', () => {
  it('matches only create submit routes', () => {
    expect(isSubmitWritePath('POST', '/v1/checks')).toBe(true);
    expect(isSubmitWritePath('POST', '/v1/jobs')).toBe(true);
    expect(isSubmitWritePath('GET', '/v1/checks')).toBe(false);
    expect(isSubmitWritePath('POST', '/v1/checks/abc')).toBe(false);
    expect(isSubmitWritePath('POST', '/v1/webhooks')).toBe(false);
  });
});

describe('parseSizeToBytes', () => {
  it('parses common units', () => {
    expect(parseSizeToBytes('256kb')).toBe(256 * 1024);
    expect(parseSizeToBytes('1mb')).toBe(1024 * 1024);
    expect(parseSizeToBytes('1024')).toBe(1024);
  });
});
