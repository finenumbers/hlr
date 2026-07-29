export { resolveSmscConfig } from './config.js';
export type { SmscAuthConfig, SmscConfig, SmscConfigInput } from './config.js';

export { SmscHttpClient } from './http-client.js';
export type { SmscHttpClientOptions } from './http-client.js';

export { SmscProvider } from './smsc-provider.js';
export type { SmscProviderOptions } from './smsc-provider.js';

export {
  PROVIDER_CODE,
  callbackDedupeKey,
  mapProviderResponse,
  mapProviderStatus,
  smscClientIdFromKey,
  verifyCallbackSignature,
} from './mapper.js';

export { mapSmscErrorCode, smscErrorFromBody, assertNoSmscError } from './errors.js';
export { redactSecrets, toPhoneDigits } from './redact.js';

export type {
  SmscBalanceBody,
  SmscCallbackPayload,
  SmscCostBody,
  SmscErrorBody,
  SmscHttpResult,
  SmscSendSuccessBody,
  SmscStatusBody,
} from './types.js';
