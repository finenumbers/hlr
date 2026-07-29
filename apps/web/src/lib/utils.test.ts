import { describe, expect, it } from 'vitest';

import { formatDate } from './utils';

describe('formatDate', () => {
  it('returns dash for nullish and empty values', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('does not throw on String(undefined) / invalid dates', () => {
    expect(formatDate('undefined')).toBe('—');
    expect(formatDate('null')).toBe('—');
    expect(formatDate('not-a-date')).toBe('—');
  });

  it('formats a valid ISO timestamp', () => {
    const out = formatDate('2026-07-30T02:15:00.000Z', 'en');
    expect(out).not.toBe('—');
    expect(out.length).toBeGreaterThan(0);
  });
});
