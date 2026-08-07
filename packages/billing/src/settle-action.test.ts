import { describe, expect, it } from 'vitest';

import { resolveJobItemSettleAction } from './settle-action.js';

describe('resolveJobItemSettleAction', () => {
  it('honors persisted CAPTURE / RELEASE', () => {
    expect(
      resolveJobItemSettleAction({
        status: 'FAILED',
        billingAction: 'CAPTURE',
        resultStatus: null,
      }),
    ).toBe('capture');
    expect(
      resolveJobItemSettleAction({
        status: 'FAILED',
        billingAction: 'RELEASE',
        resultStatus: 'error',
      }),
    ).toBe('release');
  });

  it('legacy: COMPLETED or provider resultStatus → capture', () => {
    expect(
      resolveJobItemSettleAction({ status: 'COMPLETED', billingAction: null }),
    ).toBe('capture');
    expect(
      resolveJobItemSettleAction({
        status: 'FAILED',
        billingAction: null,
        resultStatus: 'unreachable',
      }),
    ).toBe('capture');
    expect(
      resolveJobItemSettleAction({
        status: 'FAILED',
        billingAction: null,
        resultStatus: 'error',
      }),
    ).toBe('capture');
  });

  it('legacy: FAILED without resultStatus → release (do not charge)', () => {
    expect(
      resolveJobItemSettleAction({
        status: 'FAILED',
        billingAction: null,
        resultStatus: null,
      }),
    ).toBe('release');
  });
});
