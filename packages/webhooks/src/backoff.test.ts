import { describe, expect, it } from 'vitest';

import { computeNextAttemptAt, webhookRetryDelayMs } from './backoff.js';

describe('webhook backoff', () => {
  it('grows exponentially', () => {
    expect(webhookRetryDelayMs(1, 30)).toBe(30_000);
    expect(webhookRetryDelayMs(2, 30)).toBe(60_000);
    expect(webhookRetryDelayMs(3, 30)).toBe(120_000);
  });

  it('returns null nextAttempt when exhausted', () => {
    expect(
      computeNextAttemptAt({ attemptCount: 8, maxAttempts: 8 }),
    ).toBeNull();
  });

  it('schedules next attempt when retries remain', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const next = computeNextAttemptAt({
      attemptCount: 1,
      maxAttempts: 8,
      now,
      baseSec: 30,
    });
    expect(next?.toISOString()).toBe('2026-01-01T00:00:30.000Z');
  });
});
