import { ProviderError } from '@finenumbers/provider-core';
import { describe, expect, it, vi } from 'vitest';

import { resolveSmscConfig } from './config.js';
import { SmscHttpClient } from './http-client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SmscHttpClient retry / timeout', () => {
  it('retries transient HTTP 503 then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 503))
      .mockResolvedValueOnce(jsonResponse({ id: 1, cnt: 1 }));

    const client = new SmscHttpClient({
      config: resolveSmscConfig({
        login: 'u',
        password: 'p',
        retryMaxAttempts: 2,
        retryBaseDelayMs: 1,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    const result = await client.request('/sys/send.php', { phones: '7999', hlr: 1 });
    expect(result.body).toEqual({ id: 1, cnt: 1 });
    expect(result.attempts).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-transient HTTP 400', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, 400));
    const client = new SmscHttpClient({
      config: resolveSmscConfig({
        login: 'u',
        password: 'p',
        retryMaxAttempts: 3,
        retryBaseDelayMs: 1,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(client.request('/sys/send.php', { phones: '7999' })).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps abort to timeout ProviderError', async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const client = new SmscHttpClient({
      config: resolveSmscConfig({
        login: 'u',
        password: 'p',
        timeoutMs: 5,
        retryMaxAttempts: 0,
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });

    await expect(client.request('/sys/balance.php', {})).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('redacts secrets from logged params (no throw path)', async () => {
    const logs: Array<{ msg: string; fields?: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ balance: '1.00' }));
    const client = new SmscHttpClient({
      config: resolveSmscConfig({ login: 'secret-login', password: 'secret-pass' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: {
        debug: (msg, fields) => logs.push({ msg, fields }),
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    });

    await client.request('/sys/balance.php', {});
    const requestLog = logs.find((l) => l.msg === 'smsc.http.request');
    const params = requestLog?.fields?.params as Record<string, unknown>;
    expect(params.psw).toBe('[REDACTED]');
    expect(params.login).toBe('[REDACTED]');
  });
});
