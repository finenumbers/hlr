import { z } from 'zod';

/** Redis key: last successful SMSC balance poll from the worker. */
export const SMSC_BALANCE_REDIS_KEY = 'hlr:provider:smsc:balance';

export {
  maskPhone,
  maskPhonesInText,
  redactSecretsInText,
  sanitizeLogFields,
  sanitizeLogValue,
} from './redact.js';

const nonempty = z.string().min(1);

/**
 * Normalize public http(s) URLs from env.
 * Accepts bare hosts (`api.example.com`) and adds https:// (http:// for localhost).
 */
export function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const host = trimmed.replace(/^\/\//, '');
  const isLocal =
    host === 'localhost' ||
    host.startsWith('localhost:') ||
    host === '127.0.0.1' ||
    host.startsWith('127.0.0.1:');
  return `${isLocal ? 'http' : 'https'}://${host}`;
}

const publicUrl = nonempty.transform(normalizePublicUrl);

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: nonempty,
});

export const redisEnvSchema = z.object({
  REDIS_URL: nonempty,
});

/**
 * SMSC.ru credentials and HTTP client tuning.
 * Secrets never belong in PlatformSettings. Missing credentials are allowed at boot;
 * `resolveSmscConfig` / live calls fail clearly when unset.
 */
export const smscEnvSchema = z.object({
  SMSC_BASE_URL: nonempty.default('https://smsc.ru'),
  SMSC_LOGIN: z.string().optional(),
  SMSC_PASSWORD: z.string().optional(),
  SMSC_API_KEY: z.string().optional(),
  SMSC_CURRENCY: nonempty.default('RUB'),
  SMSC_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  SMSC_RETRY_MAX: z.coerce.number().int().min(0).max(10).default(2),
  SMSC_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(200),
  SMSC_CALLBACK_SECRET: z.string().optional().default(''),
});

/**
 * Pepper for API key secret hashing (HMAC-SHA256).
 * Required in production; default only for local/test bootstraps.
 */
export const apiKeyEnvSchema = z.object({
  API_KEY_PEPPER: z
    .string()
    .min(16)
    .default('dev-only-api-key-pepper-change-me'),
});

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  });

export const apiEnvSchema = baseEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(smscEnvSchema)
  .merge(apiKeyEnvSchema)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(3001),
    PUBLIC_API_URL: publicUrl.default('http://localhost:3001'),
    PUBLIC_WEB_URL: publicUrl.default('http://localhost:3000'),
    /** Opaque session token lifetime for cabinet/admin panels. */
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
    /**
     * Comma-separated browser origins allowed for CORS.
     * Defaults to PUBLIC_WEB_URL when unset.
     */
    CORS_ORIGINS: z.string().optional(),
    /** Trust X-Forwarded-* from reverse proxy (NPM). Enable in production behind NPM. */
    TRUST_PROXY: booleanish.default(false),
    /**
     * Default max JSON/urlencoded body size for non-submit routes (e.g. 256kb).
     * Submit routes use BODY_LIMIT_SUBMIT; express parser uses the max of both.
     */
    BODY_LIMIT: nonempty.default('256kb'),
    /** Max body size for POST /v1/checks and POST /v1/jobs. */
    BODY_LIMIT_SUBMIT: nonempty.default('1mb'),
    /**
     * Max multipart body for CSV upload/preview routes
     * (POST /cabinet/csv-previews, /cabinet/jobs/csv, /v1/jobs/csv).
     * Align with multer / maxCsvBytes (~50 MiB).
     */
    BODY_LIMIT_CSV: nonempty.default('52mb'),
    /** Request socket idle timeout (ms). 0 disables. */
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
    /** Idle timeout for CSV multipart routes (ms). 0 = use REQUEST_TIMEOUT_MS. */
    REQUEST_TIMEOUT_CSV_MS: z.coerce.number().int().min(0).default(120_000),
    /** Login attempts per IP per minute (auth zone). */
    AUTH_LOGIN_RPM: z.coerce.number().int().positive().default(20),
    /** Logout attempts per IP per minute (auth zone). */
    AUTH_LOGOUT_RPM: z.coerce.number().int().positive().default(60),
    /** Fallback IP RPM for other IpRateLimit scopes. */
    IP_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(120),
    /**
     * Public API read-zone RPM = submitRpm * multiplier (capped by READ max).
     * Submit zone uses PlatformSettings/tenant/key rateLimitRpm.
     */
    RATE_LIMIT_READ_MULTIPLIER: z.coerce.number().positive().default(5),
    RATE_LIMIT_READ_RPM_MAX: z.coerce.number().int().positive().default(600),
    /** Absolute ceiling for webhook-zone RPM (also capped vs submit). */
    RATE_LIMIT_WEBHOOK_RPM: z.coerce.number().int().positive().default(60),
    /** webhookRpm also <= ceil(submitRpm * this). */
    RATE_LIMIT_WEBHOOK_MULTIPLIER: z.coerce.number().positive().default(1),
    /** Expose /openapi.json outside production when true. */
    OPENAPI_ENABLED: booleanish.optional(),
    /** Prometheus metrics endpoint. */
    METRICS_ENABLED: booleanish.default(true),
    /**
     * When set, GET /metrics requires `Authorization: Bearer <token>`.
     * Prefer setting this in production even if NPM denies /metrics publicly.
     */
    METRICS_SCRAPE_TOKEN: z.string().optional().default(''),
    /** Max job items for XLSX export (hard cap; larger jobs → 413). */
    JOB_ITEMS_EXPORT_MAX: z.coerce.number().int().positive().default(50_000),
    /** Directory for CSV bulk uploads (api writes, worker reads). */
    UPLOAD_DIR: nonempty.default('./data/uploads'),
  })
  .superRefine((env, ctx) => {
    if (
      env.NODE_ENV === 'production' &&
      env.API_KEY_PEPPER === 'dev-only-api-key-pepper-change-me'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_KEY_PEPPER'],
        message: 'API_KEY_PEPPER must be set to a strong secret in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.SMSC_CALLBACK_SECRET.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMSC_CALLBACK_SECRET'],
        message: 'SMSC_CALLBACK_SECRET must be set in production',
      });
    }
  });

export const workerEnvSchema = baseEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(smscEnvSchema)
  .extend({
    WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    /** HTTP port for Prometheus scrape (/metrics, /health/live). */
    WORKER_METRICS_PORT: z.coerce.number().int().positive().default(9091),
    METRICS_ENABLED: booleanish.default(true),
    /** How often to refresh queue depth gauges (ms). */
    QUEUE_METRICS_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
    /** How often to poll SMSC balance for metrics (ms). 0 disables. */
    PROVIDER_BALANCE_POLL_MS: z.coerce.number().int().min(0).default(300_000),
    /** Directory for CSV bulk uploads (must match api UPLOAD_DIR). */
    UPLOAD_DIR: nonempty.default('./data/uploads'),
    /** Orphan upload file TTL (hours). Parsed files are unlinked immediately. */
    UPLOAD_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.SMSC_CALLBACK_SECRET.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMSC_CALLBACK_SECRET'],
        message: 'SMSC_CALLBACK_SECRET must be set in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;
export type SmscEnv = z.infer<typeof smscEnvSchema>;

export type LoadEnvOptions = {
  /** Extra source object (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
};

export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  options: LoadEnvOptions = {},
): z.infer<T> {
  const source = options.env ?? process.env;
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return parsed.data;
}

export function loadApiEnv(options?: LoadEnvOptions): ApiEnv {
  return loadEnv(apiEnvSchema, options);
}

export function loadWorkerEnv(options?: LoadEnvOptions): WorkerEnv {
  return loadEnv(workerEnvSchema, options);
}

/** Resolve CORS allow-list from env (bare hosts → https://). */
export function resolveCorsOrigins(env: Pick<ApiEnv, 'CORS_ORIGINS' | 'PUBLIC_WEB_URL'>): string[] {
  const raw = env.CORS_ORIGINS?.trim()
    ? env.CORS_ORIGINS.split(',')
    : [env.PUBLIC_WEB_URL];

  return [
    ...new Set(
      raw
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => normalizePublicUrl(origin)),
    ),
  ];
}
