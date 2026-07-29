/**
 * Exponential backoff for webhook retries (seconds → ms).
 * attempt 1 → base, 2 → 2*base, … capped.
 */
export function webhookRetryDelayMs(attemptCount: number, baseSec = 30): number {
  const attempt = Math.max(1, attemptCount);
  const exp = Math.min(8, attempt - 1);
  return baseSec * 1000 * 2 ** exp;
}

export function computeNextAttemptAt(input: {
  attemptCount: number;
  maxAttempts: number;
  now?: Date;
  baseSec?: number;
}): Date | null {
  if (input.attemptCount >= input.maxAttempts) {
    return null;
  }
  const now = input.now ?? new Date();
  return new Date(now.getTime() + webhookRetryDelayMs(input.attemptCount, input.baseSec));
}
