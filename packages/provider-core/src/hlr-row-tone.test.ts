import { describe, expect, it } from 'vitest';

import { hlrRowTone } from './hlr-row-tone.js';

describe('hlrRowTone', () => {
  it('maps reachable → success', () => {
    expect(hlrRowTone({ resultStatus: 'reachable' })).toBe('success');
  });

  it('maps unreachable → fail', () => {
    expect(hlrRowTone({ resultStatus: 'unreachable' })).toBe('fail');
  });

  it('maps error → error', () => {
    expect(hlrRowTone({ resultStatus: 'error' })).toBe('error');
  });

  it('maps FAILED with empty resultStatus → error', () => {
    expect(hlrRowTone({ resultStatus: null, status: 'FAILED' })).toBe('error');
    expect(hlrRowTone({ resultStatus: '', status: 'FAILED' })).toBe('error');
  });

  it('returns null for pending / unknown / in-flight', () => {
    expect(hlrRowTone({ resultStatus: 'pending' })).toBeNull();
    expect(hlrRowTone({ resultStatus: 'unknown' })).toBeNull();
    expect(hlrRowTone({ resultStatus: null, status: 'QUEUED' })).toBeNull();
    expect(hlrRowTone({ resultStatus: null, status: 'PENDING' })).toBeNull();
  });

  it('prefers resultStatus over FAILED status', () => {
    expect(
      hlrRowTone({ resultStatus: 'unreachable', status: 'FAILED' }),
    ).toBe('fail');
    expect(
      hlrRowTone({ resultStatus: 'reachable', status: 'COMPLETED' }),
    ).toBe('success');
  });
});
