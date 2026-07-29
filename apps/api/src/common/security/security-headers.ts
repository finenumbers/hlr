import type { HelmetOptions } from 'helmet';

/**
 * Helmet options tuned for a JSON API (not a document app).
 * - Production: strict CSP (no scripts), HSTS, deny framing.
 * - Dev with Swagger UI: CSP relaxed so /docs can render.
 */
export function buildApiHelmetOptions(input: {
  isProduction: boolean;
  swaggerUiEnabled: boolean;
}): HelmetOptions {
  return {
    // API responses are JSON; block active content and embedding.
    contentSecurityPolicy: input.swaggerUiEnabled
      ? false
      : {
          useDefaults: false,
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
            formAction: ["'none'"],
          },
        },
    crossOriginEmbedderPolicy: false,
    // Browser SPA on another origin must read API responses.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    noSniff: true,
    originAgentCluster: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    hsts: input.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  };
}

export type CorsHardeningOptions = {
  origins: string[];
  isProduction: boolean;
};

/** Explicit CORS allow-list for credentialed browser clients (cabinet). */
export function buildApiCorsOptions(input: CorsHardeningOptions) {
  return {
    origin: input.origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Id',
      'Idempotency-Key',
      'X-Request-Id',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Zone',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: input.isProduction ? 600 : 0,
    optionsSuccessStatus: 204,
  };
}
