import { describe, expect, it } from 'vitest';

import { chunkArray, normalizeAndDeduplicatePhones, normalizePhoneE164 } from './phone.js';
import { JobsValidationError } from './types.js';

describe('normalizePhoneE164', () => {
  it('normalizes RU numbers to E.164', () => {
    expect(normalizePhoneE164('79991234567')).toBe('+79991234567');
    expect(normalizePhoneE164('+7 999 123-45-67')).toBe('+79991234567');
  });

  it('rejects invalid numbers', () => {
    expect(() => normalizePhoneE164('123')).toThrow(JobsValidationError);
  });
});

describe('normalizeAndDeduplicatePhones', () => {
  it('deduplicates equivalent numbers', () => {
    const result = normalizeAndDeduplicatePhones([
      '+79991234567',
      '79991234567',
      '+7 999 123-45-67',
      '+79997654321',
    ]);
    expect(result.phones).toEqual(['+79991234567', '+79997654321']);
    expect(result.deduplicatedCount).toBe(2);
    expect(result.invalid).toHaveLength(0);
  });

  it('collects invalid entries', () => {
    const result = normalizeAndDeduplicatePhones(['+79991234567', 'not-a-phone']);
    expect(result.phones).toEqual(['+79991234567']);
    expect(result.invalid).toHaveLength(1);
  });
});

describe('chunkArray', () => {
  it('splits into batches', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
