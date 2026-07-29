/**
 * Request-scoped principal for public API key authentication (`/v1`).
 * Independent from session/JWT `AuthenticatedUser`.
 */
export type AuthenticatedApiKey = {
  apiKeyId: string;
  tenantId: string;
  prefix: string;
  name: string;
  scopes: string[];
  rateLimitRpm: number | null;
};
