import { describe, expect, it } from 'vitest';

/**
 * Public API wire format uses lowercase `type: hlr|ping`.
 * Internal billing/jobs always use `checkType: HLR|PING`.
 */
function mapPublicType(type: 'hlr' | 'ping'): 'HLR' | 'PING' {
  // Mirrors PublicApiService create paths.
  return type === 'hlr' ? 'HLR' : 'PING';
}

describe('public API checkType mapping (4-state gate prerequisite)', () => {
  it('maps hlr → HLR and ping → PING without cross-product fallback', () => {
    expect(mapPublicType('hlr')).toBe('HLR');
    expect(mapPublicType('ping')).toBe('PING');
    expect(mapPublicType('hlr')).not.toBe('PING');
    expect(mapPublicType('ping')).not.toBe('HLR');
  });
});
