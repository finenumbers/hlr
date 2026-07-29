export type SmscAuthConfig =
  | { mode: 'login'; login: string; password: string }
  | { mode: 'apikey'; apiKey: string };

export type SmscConfig = {
  baseUrl: string;
  auth: SmscAuthConfig;
  /** Default currency label for cost/balance (SMSC does not always return ISO currency). */
  currency: string;
  timeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  /** Shared secret for callback signature verification (md5/sha1). Empty = skip verify. */
  callbackSecret: string;
};

export type SmscConfigInput = {
  baseUrl?: string;
  login?: string;
  password?: string;
  apiKey?: string;
  currency?: string;
  timeoutMs?: number;
  retryMaxAttempts?: number;
  retryBaseDelayMs?: number;
  callbackSecret?: string;
};

export function resolveSmscConfig(input: SmscConfigInput): SmscConfig {
  const baseUrl = (input.baseUrl ?? 'https://smsc.ru').replace(/\/+$/, '');
  const apiKey = input.apiKey?.trim();
  const login = input.login?.trim();
  const password = input.password;

  let auth: SmscAuthConfig;
  if (apiKey) {
    auth = { mode: 'apikey', apiKey };
  } else if (login && password !== undefined && password !== '') {
    auth = { mode: 'login', login, password };
  } else {
    throw new Error(
      'SMSC credentials missing: set SMSC_API_KEY or SMSC_LOGIN + SMSC_PASSWORD',
    );
  }

  return {
    baseUrl,
    auth,
    currency: input.currency ?? 'RUB',
    timeoutMs: input.timeoutMs ?? 15_000,
    retryMaxAttempts: input.retryMaxAttempts ?? 2,
    retryBaseDelayMs: input.retryBaseDelayMs ?? 200,
    callbackSecret: input.callbackSecret ?? '',
  };
}
