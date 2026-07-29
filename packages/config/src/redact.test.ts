import { describe, expect, it } from 'vitest';

import { maskPhone, redactSecretsInText, sanitizeLogFields } from './redact.js';

describe('maskPhone', () => {
  it('masks middle digits', () => {
    expect(maskPhone('+79991234567')).toBe('+799***4567');
  });
});

describe('redactSecretsInText', () => {
  it('redacts API keys, webhook secrets, and bearer tokens', () => {
    expect(
      redactSecretsInText(
        'key=fnk_live_abc123XYZ Authorization: Bearer eyJhbG.ciOi whsec_deadbeef99',
      ),
    ).toBe('key=[REDACTED] Authorization: [REDACTED] [REDACTED]');
  });
});

describe('sanitizeLogFields', () => {
  it('redacts secrets and masks phones', () => {
    const result = sanitizeLogFields({
      password: 'super-secret',
      apiKey: 'fnk_live_x',
      signingSecret: 'whsec_abc',
      phoneE164: '+79991234567',
      note: 'call +79997654321 with fnk_live_secretkey99',
      nested: { token: 'abc' },
    });

    expect(result).toEqual({
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
      signingSecret: '[REDACTED]',
      phoneE164: '+799***4567',
      note: 'call +799***4321 with [REDACTED]',
      nested: { token: '[REDACTED]' },
    });
  });
});
