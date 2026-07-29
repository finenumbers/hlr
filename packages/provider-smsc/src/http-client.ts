import { ProviderError } from '@finenumbers/provider-core';
import type { ProviderLogger } from '@finenumbers/provider-core';

import type { SmscAuthConfig, SmscConfig } from './config.js';
import { redactSecrets } from './redact.js';
import type { SmscHttpResult } from './types.js';

export type SmscHttpClientOptions = {
  config: SmscConfig;
  logger?: ProviderLogger;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

type RequestParams = Record<string, string | number | undefined | null>;

const TRANSIENT_HTTP = new Set([408, 425, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authParams(auth: SmscAuthConfig): Record<string, string> {
  if (auth.mode === 'apikey') {
    return { apikey: auth.apiKey };
  }
  return { login: auth.login, psw: auth.password };
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

function isTransientNetworkError(error: unknown): boolean {
  if (isAbortError(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network')
  );
}

/**
 * Low-level SMSC HTTP wrapper: auth, fmt=3, timeouts, transient retries, redacted logs.
 */
export class SmscHttpClient {
  private readonly config: SmscConfig;
  private readonly logger?: ProviderLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SmscHttpClientOptions) {
    this.config = options.config;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async request<T = unknown>(
    path: string,
    params: RequestParams,
    options: { correlationId?: string; kind?: string } = {},
  ): Promise<SmscHttpResult<T>> {
    const url = new URL(path, `${this.config.baseUrl}/`);
    const merged: Record<string, string> = {
      ...authParams(this.config.auth),
      fmt: '3',
      charset: 'utf-8',
    };
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      merged[key] = String(value);
    }

    const body = new URLSearchParams(merged);
    const maxAttempts = Math.max(1, this.config.retryMaxAttempts + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

      this.logger?.debug('smsc.http.request', {
        path,
        kind: options.kind,
        attempt,
        correlationId: options.correlationId,
        params: redactSecrets(Object.fromEntries(body.entries())),
      });

      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            accept: 'application/json,text/plain,*/*',
            ...(options.correlationId
              ? { 'x-correlation-id': options.correlationId }
              : {}),
          },
          body,
          signal: controller.signal,
        });

        const text = await response.text();
        const parsed = parseJsonBody(text);
        const durationMs = Date.now() - started;

        if (!response.ok && TRANSIENT_HTTP.has(response.status) && attempt < maxAttempts) {
          this.logger?.warn('smsc.http.transient_http', {
            path,
            httpStatus: response.status,
            attempt,
            correlationId: options.correlationId,
          });
          await this.sleep(this.config.retryBaseDelayMs * attempt);
          continue;
        }

        if (!response.ok) {
          throw new ProviderError({
            providerCode: 'smsc',
            kind: response.status === 401 || response.status === 403 ? 'auth' : 'network',
            message: `SMSC HTTP ${response.status}`,
            httpStatus: response.status,
            retryable: TRANSIENT_HTTP.has(response.status),
            correlationId: options.correlationId,
            rawResponse: parsed,
          });
        }

        this.logger?.debug('smsc.http.response', {
          path,
          kind: options.kind,
          attempt,
          httpStatus: response.status,
          durationMs,
          correlationId: options.correlationId,
          body: redactSecrets(parsed),
        });

        return {
          ok: true,
          httpStatus: response.status,
          body: parsed as T,
          durationMs,
          attempts: attempt,
          urlPath: path,
        };
      } catch (error) {
        lastError = error;
        if (error instanceof ProviderError) {
          throw error;
        }

        const timeout = isAbortError(error);
        const retryable = timeout || isTransientNetworkError(error);

        if (retryable && attempt < maxAttempts) {
          this.logger?.warn('smsc.http.retry', {
            path,
            attempt,
            timeout,
            correlationId: options.correlationId,
            message: error instanceof Error ? error.message : String(error),
          });
          await this.sleep(this.config.retryBaseDelayMs * attempt);
          continue;
        }

        throw new ProviderError({
          providerCode: 'smsc',
          kind: timeout ? 'timeout' : 'network',
          message: timeout
            ? `SMSC request timed out after ${this.config.timeoutMs}ms`
            : `SMSC network error: ${error instanceof Error ? error.message : String(error)}`,
          retryable,
          correlationId: options.correlationId,
          cause: error,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ProviderError({
      providerCode: 'smsc',
      kind: 'network',
      message: 'SMSC request failed after retries',
      retryable: true,
      correlationId: options.correlationId,
      cause: lastError,
    });
  }
}

function parseJsonBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // SMSC occasionally returns plain text on misconfiguration; keep raw.
    return { _nonJson: true, text: trimmed };
  }
}
