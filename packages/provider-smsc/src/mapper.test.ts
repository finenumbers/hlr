import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  callbackDedupeKey,
  mapProviderResponse,
  mapProviderStatus,
  verifyCallbackSignature,
} from './mapper.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as T;
}

describe('mapProviderResponse', () => {
  it('maps send acknowledgement to accepted/pending', () => {
    const raw = loadFixture('send-hlr-success.json');
    const result = mapProviderResponse({
      checkType: 'HLR',
      raw,
      phoneE164: '+79991234567',
      currency: 'RUB',
    });

    expect(result.lifecycleStatus).toBe('accepted');
    expect(result.resultStatus).toBe('pending');
    expect(result.providerMessageId).toBe('1001');
    expect(result.cost).toBe('0.30');
    expect(result.isReachable).toBeNull();
  });

  it('maps HLR reachable status', () => {
    const raw = loadFixture('status-hlr-reachable.json');
    const result = mapProviderResponse({ checkType: 'HLR', raw, currency: 'RUB' });

    expect(result.lifecycleStatus).toBe('completed');
    expect(result.resultStatus).toBe('reachable');
    expect(result.isReachable).toBe(true);
    expect(result.imsi).toBe('250011234567890');
    expect(result.mcc).toBe('250');
    expect(result.mnc).toBe('01');
    expect(result.operatorName).toBe('MTS');
    expect(result.countryCode).toBe('Russia');
    expect(result.phoneE164).toBe('+79991234567');
  });

  it('maps HLR unreachable with provider err preserved', () => {
    const raw = loadFixture('status-hlr-unreachable.json');
    const result = mapProviderResponse({ checkType: 'HLR', raw });

    expect(result.lifecycleStatus).toBe('completed');
    expect(result.resultStatus).toBe('unreachable');
    expect(result.isReachable).toBe(false);
    expect(result.providerErrorCode).toBe('23');
    expect(result.providerStatusCode).toBe('1');
  });

  it('maps pending status', () => {
    const raw = loadFixture('status-pending.json');
    const result = mapProviderResponse({ checkType: 'HLR', raw });

    expect(result.lifecycleStatus).toBe('pending');
    expect(result.resultStatus).toBe('pending');
    expect(result.isReachable).toBeNull();
  });

  it('maps API-level error body without dropping codes', () => {
    const raw = loadFixture('send-error-auth.json');
    const result = mapProviderResponse({ checkType: 'PING', raw });

    expect(result.lifecycleStatus).toBe('failed');
    expect(result.resultStatus).toBe('error');
    expect(result.providerErrorCode).toBe('2');
    expect(result.providerErrorMessage).toContain('invalid login');
  });

  it('maps callback payload through the same pipeline', () => {
    const raw = loadFixture('callback-hlr.json');
    const result = mapProviderResponse({ checkType: 'HLR', raw });

    expect(result.lifecycleStatus).toBe('completed');
    expect(result.resultStatus).toBe('reachable');
    expect(result.providerMessageId).toBe('1001');
    expect(result.imsi).toBe('250011234567890');
  });
});

describe('mapProviderStatus', () => {
  it('maps status -3 to failed', () => {
    const result = mapProviderStatus({
      checkType: 'HLR',
      statusCode: -3,
      providerMessageId: '9',
    });
    expect(result.lifecycleStatus).toBe('failed');
    expect(result.resultStatus).toBe('error');
  });

  it('maps delivery failure statuses to unreachable completed', () => {
    const result = mapProviderStatus({
      checkType: 'PING',
      statusCode: 20,
      providerMessageId: '9',
    });
    expect(result.lifecycleStatus).toBe('completed');
    expect(result.resultStatus).toBe('unreachable');
    expect(result.isReachable).toBe(false);
  });
});

describe('callback parsing helpers', () => {
  it('builds stable dedupe keys', () => {
    const a = loadFixture<Record<string, unknown>>('callback-hlr.json');
    const b = { ...a };
    expect(callbackDedupeKey(a)).toBe(callbackDedupeKey(b));
    expect(callbackDedupeKey({ ...a, status: '20' })).not.toBe(callbackDedupeKey(a));
  });

  it('verifies md5 callback signature', () => {
    const secret = 'test-secret';
    const payload = {
      id: '1001',
      phone: '79991234567',
      status: '1',
    };
    const md5 = createHash('md5')
      .update(`${payload.id}:${payload.phone}:${payload.status}:${secret}`)
      .digest('hex');

    expect(
      verifyCallbackSignature({
        payload,
        secret,
        signatures: { md5 },
      }),
    ).toBe(true);

    expect(
      verifyCallbackSignature({
        payload,
        secret,
        signatures: { md5: 'deadbeef' },
      }),
    ).toBe(false);

    expect(verifyCallbackSignature({ payload, secret: '' })).toBeNull();
  });
});
