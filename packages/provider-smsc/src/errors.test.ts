import { describe, expect, it } from 'vitest';

import { mapSmscErrorCode, smscErrorFromBody } from './errors.js';

describe('mapSmscErrorCode', () => {
  it('classifies auth / funds / validation / rate limit', () => {
    expect(mapSmscErrorCode(2)).toEqual({ kind: 'auth', retryable: false });
    expect(mapSmscErrorCode(3)).toEqual({
      kind: 'insufficient_funds',
      retryable: false,
    });
    expect(mapSmscErrorCode(7)).toEqual({ kind: 'validation', retryable: false });
    expect(mapSmscErrorCode(9)).toEqual({ kind: 'rate_limit', retryable: true });
  });
});

describe('smscErrorFromBody', () => {
  it('preserves original error_code and text', () => {
    const err = smscErrorFromBody({
      error: 'invalid login or password',
      error_code: 2,
    });
    expect(err.providerErrorCode).toBe(2);
    expect(err.providerErrorMessage).toBe('invalid login or password');
    expect(err.kind).toBe('auth');
    expect(err.retryable).toBe(false);
  });
});
