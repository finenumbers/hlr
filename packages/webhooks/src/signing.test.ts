import { describe, expect, it } from 'vitest';

import {
  parseSignatureHeader,
  signWebhookPayload,
  verifyWebhookSignature,
} from './signing.js';

describe('webhook signing', () => {
  const secret = 'whsec_test_secret';
  const rawBody = '{"apiVersion":"v1","id":"del_1","type":"check.completed"}';

  it('signs and verifies a payload', () => {
    const { header, timestampSec } = signWebhookPayload({
      secret,
      rawBody,
      timestampSec: 1_700_000_000,
    });
    expect(header).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    expect(
      verifyWebhookSignature({
        secret,
        rawBody,
        header,
        nowSec: timestampSec,
      }),
    ).toBe(true);
  });

  it('rejects tampered body', () => {
    const { header, timestampSec } = signWebhookPayload({ secret, rawBody });
    expect(
      verifyWebhookSignature({
        secret,
        rawBody: rawBody + ' ',
        header,
        nowSec: timestampSec,
      }),
    ).toBe(false);
  });

  it('rejects wrong secret', () => {
    const { header, timestampSec } = signWebhookPayload({ secret, rawBody });
    expect(
      verifyWebhookSignature({
        secret: 'other',
        rawBody,
        header,
        nowSec: timestampSec,
      }),
    ).toBe(false);
  });

  it('rejects expired signatures', () => {
    const { header } = signWebhookPayload({
      secret,
      rawBody,
      timestampSec: 1_000,
    });
    expect(
      verifyWebhookSignature({
        secret,
        rawBody,
        header,
        toleranceSec: 60,
        nowSec: 10_000,
      }),
    ).toBe(false);
  });

  it('parses signature header', () => {
    expect(parseSignatureHeader('t=123,v1=abcd')).toEqual({
      timestampSec: 123,
      signature: 'abcd',
    });
    expect(parseSignatureHeader('invalid')).toBeNull();
  });
});
