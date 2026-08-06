import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryProviderPersistence, ProviderError } from '@finenumbers/provider-core';
import { describe, expect, it, vi } from 'vitest';

import { resolveSmscConfig } from './config.js';
import { SmscHttpClient } from './http-client.js';
import { SmscProvider } from './smsc-provider.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SmscProvider', () => {
  it('submits HLR and persists redacted request/response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(loadFixture('send-hlr-success.json')));
    const persistence = new InMemoryProviderPersistence();
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p', currency: 'RUB' }),
      persistence,
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    const result = await provider.submitHlr({
      phoneE164: '+79991234567',
      idempotencyKey: 'item-1',
      tenantId: 'tenant-1',
      jobItemId: 'job-item-1',
    });

    expect(result.providerMessageId).toBe('1001');
    expect(result.accepted).toBe(true);
    expect(result.normalized.lifecycleStatus).toBe('accepted');
    expect(result.deduplicated).toBe(false);

    const stored = [...persistence.requests.values()][0]!;
    expect(stored.status).toBe('SUCCEEDED');
    expect(stored.requestPayload).toBeTruthy();
    expect(stored.responsePayload).toEqual(loadFixture('send-hlr-success.json'));
    expect(stored.normalizedResult?.lifecycleStatus).toBe('accepted');
    expect(stored.normalizedResult?.providerMessageId).toBe('1001');
    expect(JSON.stringify(stored.requestPayload)).not.toContain('secret');
    expect((stored.requestPayload as { psw?: string }).psw).toBeUndefined();
  });

  it('deduplicates successful submits by idempotency key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(loadFixture('send-hlr-success.json')));
    const persistence = new InMemoryProviderPersistence();
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p' }),
      persistence,
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    const input = {
      phoneE164: '+79991234567',
      idempotencyKey: 'item-1',
      tenantId: 'tenant-1',
      jobItemId: 'job-item-1',
    };

    await provider.submitHlr(input);
    const second = await provider.submitHlr(input);

    expect(second.deduplicated).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks concurrent in-flight submit with the same idempotency key', async () => {
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockReturnValue(gate);
    const persistence = new InMemoryProviderPersistence();
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p' }),
      persistence,
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    const input = {
      phoneE164: '+79991234567',
      idempotencyKey: 'item-inflight',
      tenantId: 'tenant-1',
      jobItemId: 'job-item-1',
    };

    const first = provider.submitHlr(input);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await expect(provider.submitHlr(input)).rejects.toMatchObject({
      kind: 'conflict',
      retryable: true,
    });

    release(jsonResponse(loadFixture('send-hlr-success.json')));
    await first;
  });

  it('allows retry after a failed submit with the same idempotency key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(loadFixture('send-error-auth.json')))
      .mockResolvedValueOnce(jsonResponse(loadFixture('send-hlr-success.json')));
    const persistence = new InMemoryProviderPersistence();
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p' }),
      persistence,
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    const input = {
      phoneE164: '+79991234567',
      idempotencyKey: 'item-retry',
      tenantId: 'tenant-1',
      jobItemId: 'job-item-1',
    };

    await expect(provider.submitHlr(input)).rejects.toBeInstanceOf(ProviderError);
    const second = await provider.submitHlr(input);
    expect(second.deduplicated).toBe(false);
    expect(second.providerMessageId).toBe('1001');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('estimates HLR cost', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(loadFixture('cost-hlr.json')));
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p', currency: 'RUB' }),
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    const estimate = await provider.estimateHlrCost({ phoneE164: '+79991234567' });
    expect(estimate.cost).toBe('0.30');
    expect(estimate.parts).toBe(1);
    expect(estimate.checkType).toBe('HLR');
  });

  it('surfaces provider auth errors with original code', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(loadFixture('send-error-auth.json')));
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p' }),
      http: new SmscHttpClient({
        config: resolveSmscConfig({ login: 'u', password: 'p' }),
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    });

    try {
      await provider.submitPing({
        phoneE164: '+79991234567',
        idempotencyKey: 'x',
        tenantId: 't',
        jobItemId: 'j',
      });
      expect.fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).providerErrorCode).toBe(2);
      expect((error as ProviderError).kind).toBe('auth');
    }
  });

  it('rejects callbacks when callback secret is not configured', async () => {
    const persistence = new InMemoryProviderPersistence();
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p', callbackSecret: '' }),
      persistence,
    });

    const raw = loadFixture('callback-hlr.json');
    await expect(provider.handleProviderCallback({ rawPayload: raw })).rejects.toMatchObject({
      kind: 'signature',
      message: 'SMSC callback secret is not configured',
    });
  });

  it('normalizes callbacks via shared pipeline when signature is valid', async () => {
    const persistence = new InMemoryProviderPersistence();
    const secret = 'callback-secret';
    const provider = new SmscProvider({
      config: resolveSmscConfig({ login: 'u', password: 'p', callbackSecret: secret }),
      persistence,
    });

    const raw = loadFixture('callback-hlr.json') as Record<string, unknown>;
    const id = String(raw.id ?? '');
    const phone = String(raw.phone ?? '');
    const status = String(raw.status ?? '');
    const { createHash } = await import('node:crypto');
    const base = `${id}:${phone}:${status}:${secret}`;
    raw.md5 = createHash('md5').update(base).digest('hex');

    const result = await provider.handleProviderCallback({ rawPayload: raw });

    expect(result.normalized.resultStatus).toBe('reachable');
    expect(result.signatureValid).toBe(true);
    expect(result.deduplicated).toBe(false);

    const stored = [...persistence.callbacks.values()][0]!;
    expect(stored.normalizedResult?.resultStatus).toBe('reachable');
    expect(stored.normalizedResult?.imsi).toBe('250011234567890');

    const again = await provider.handleProviderCallback({ rawPayload: raw });
    expect(again.deduplicated).toBe(true);
  });
});
