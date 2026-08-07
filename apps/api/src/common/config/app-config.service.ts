import { Inject, Injectable } from '@nestjs/common';
import { resolveCorsOrigins, type ApiEnv } from '@finenumbers/config';

import { APP_CONFIG } from './app-config.tokens';

@Injectable()
export class AppConfigService {
  constructor(@Inject(APP_CONFIG) private readonly env: ApiEnv) {}

  get raw(): ApiEnv {
    return this.env;
  }

  get nodeEnv(): ApiEnv['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }

  /**
   * Interactive Swagger UI (`/docs`).
   * Always off in production — never publicly exposable.
   */
  get swaggerUiEnabled(): boolean {
    return !this.isProduction;
  }

  /**
   * Machine-readable OpenAPI (`/openapi.json`).
   * Always off in production (schema enumeration risk).
   * Outside production: on by default; set OPENAPI_ENABLED=false to disable.
   */
  get openApiEnabled(): boolean {
    if (this.isProduction) {
      return false;
    }
    if (this.env.OPENAPI_ENABLED !== undefined) {
      return this.env.OPENAPI_ENABLED;
    }
    return true;
  }

  get apiPort(): number {
    return this.env.API_PORT;
  }

  get publicApiUrl(): string {
    return this.env.PUBLIC_API_URL;
  }

  get publicWebUrl(): string {
    return this.env.PUBLIC_WEB_URL;
  }

  get corsOrigins(): string[] {
    const origins = resolveCorsOrigins(this.env);
    if (!this.isProduction) {
      origins.push('http://localhost:3000');
    }
    return [...new Set(origins)];
  }

  get trustProxy(): boolean {
    return this.env.TRUST_PROXY;
  }

  get bodyLimit(): string {
    return this.env.BODY_LIMIT;
  }

  get bodyLimitSubmit(): string {
    return this.env.BODY_LIMIT_SUBMIT;
  }

  get bodyLimitCsv(): string {
    return this.env.BODY_LIMIT_CSV;
  }

  get requestTimeoutMs(): number {
    return this.env.REQUEST_TIMEOUT_MS;
  }

  get requestTimeoutCsvMs(): number {
    return this.env.REQUEST_TIMEOUT_CSV_MS;
  }

  get authLoginRpm(): number {
    return this.env.AUTH_LOGIN_RPM;
  }

  get authLogoutRpm(): number {
    return this.env.AUTH_LOGOUT_RPM;
  }

  get ipRateLimitRpm(): number {
    return this.env.IP_RATE_LIMIT_RPM;
  }

  get rateLimitReadMultiplier(): number {
    return this.env.RATE_LIMIT_READ_MULTIPLIER;
  }

  get rateLimitReadRpmMax(): number {
    return this.env.RATE_LIMIT_READ_RPM_MAX;
  }

  get rateLimitWebhookRpm(): number {
    return this.env.RATE_LIMIT_WEBHOOK_RPM;
  }

  get rateLimitWebhookMultiplier(): number {
    return this.env.RATE_LIMIT_WEBHOOK_MULTIPLIER;
  }

  get metricsEnabled(): boolean {
    return this.env.METRICS_ENABLED;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get uploadDir(): string {
    return this.env.UPLOAD_DIR;
  }

  get smscBaseUrl(): string {
    return this.env.SMSC_BASE_URL;
  }

  get smscConfigured(): boolean {
    const apiKey = this.env.SMSC_API_KEY?.trim();
    const login = this.env.SMSC_LOGIN?.trim();
    return Boolean(apiKey || (login && this.env.SMSC_PASSWORD));
  }

  get smscCallbackSecretConfigured(): boolean {
    return Boolean(this.env.SMSC_CALLBACK_SECRET?.trim());
  }

  get smscCallbackSecret(): string {
    return this.env.SMSC_CALLBACK_SECRET?.trim() ?? '';
  }

  /** Pepper for hashing API key secrets (never log). */
  get apiKeyPepper(): string {
    return this.env.API_KEY_PEPPER;
  }
}
