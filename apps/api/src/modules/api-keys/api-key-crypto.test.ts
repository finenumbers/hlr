import { describe, expect, it } from 'vitest';

import {
  generateApiKeyMaterial,
  hashApiKeySecret,
  maskApiKeyPrefix,
  parseApiKey,
  verifyApiKeySecret,
} from './api-key-crypto';

describe('api-key-crypto', () => {
  const pepper = 'test-pepper-value-16';

  it('generates parseable keys', () => {
    const material = generateApiKeyMaterial();
    const parsed = parseApiKey(material.rawKey);
    expect(parsed).toEqual({
      prefix: material.prefix,
      secret: material.secret,
    });
  });

  it('hashes and verifies secrets', () => {
    const { secret } = generateApiKeyMaterial();
    const hash = hashApiKeySecret(secret, pepper);
    expect(verifyApiKeySecret({ secret, secretHash: hash, pepper })).toBe(true);
    expect(
      verifyApiKeySecret({ secret: 'wrong', secretHash: hash, pepper }),
    ).toBe(false);
  });

  it('rejects malformed keys', () => {
    expect(parseApiKey('not-a-key')).toBeNull();
    expect(parseApiKey('fnk_live_short_x')).toBeNull();
  });

  it('parses secrets that contain underscores (base64url)', () => {
    const raw = `fnk_live_${'a'.repeat(12)}_sec_ret_with_underscores`;
    expect(parseApiKey(raw)).toEqual({
      prefix: 'a'.repeat(12),
      secret: 'sec_ret_with_underscores',
    });
  });

  it('masks prefix for display', () => {
    expect(maskApiKeyPrefix('abcdefghijkl')).toBe('fnk_live_abcdefghijkl_****');
  });
});
