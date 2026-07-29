import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadApiEnv } from '@finenumbers/config';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { AppLogger } from './common/logger/app-logger.service';
import { createPayloadSizeMiddleware } from './common/middleware/payload-size.middleware';
import { parseSizeToBytes } from './common/rate-limit/rate-limit-zone';
import { RequestContextService } from './common/request-context/request-context.service';
import {
  buildApiCorsOptions,
  buildApiHelmetOptions,
} from './common/security/security-headers';

async function bootstrap(): Promise<void> {
  // Fail fast if env is invalid (also validated again via AppConfigModule factory).
  const env = loadApiEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(AppConfigService);
  const requestContext = app.get(RequestContextService);
  const logger = app.get(AppLogger).child('Bootstrap');
  app.useLogger(logger);

  app.enableShutdownHooks();

  // Behind NPM / reverse proxy: use X-Forwarded-* for req.ip and secure cookies.
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet(
      buildApiHelmetOptions({
        isProduction: config.isProduction,
        swaggerUiEnabled: config.swaggerUiEnabled,
      }),
    ),
  );

  // Payload size: zone-aware Content-Length check, then parser at submit max.
  app.use(
    createPayloadSizeMiddleware({
      bodyLimit: config.bodyLimit,
      bodyLimitSubmit: config.bodyLimitSubmit,
    }),
  );
  const parserLimitBytes = Math.max(
    parseSizeToBytes(config.bodyLimit),
    parseSizeToBytes(config.bodyLimitSubmit),
  );
  app.useBodyParser('json', { limit: parserLimitBytes });
  app.useBodyParser('urlencoded', {
    limit: parserLimitBytes,
    extended: true,
  });

  app.enableCors(
    buildApiCorsOptions({
      origins: config.corsOrigins,
      isProduction: config.isProduction,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  setupOpenApi(app, config, logger);

  const server = await app.listen(env.API_PORT);
  if (config.requestTimeoutMs > 0) {
    server.setTimeout(config.requestTimeoutMs);
    server.requestTimeout = config.requestTimeoutMs;
    server.headersTimeout = config.requestTimeoutMs + 5_000;
  }

  logger.log(
    `API listening on http://localhost:${env.API_PORT} (requestId via ALS ready=${Boolean(requestContext)}; trustProxy=${config.trustProxy}; swagger=${config.swaggerUiEnabled}; openapi=${config.openApiEnabled})`,
  );
}

function setupOpenApi(
  app: NestExpressApplication,
  config: AppConfigService,
  logger: AppLogger,
): void {
  // Defense-in-depth: never mount docs surfaces in production.
  if (config.isProduction) {
    blockDocsRoutes(app);
    logger.log('OpenAPI and Swagger UI disabled in production');
    return;
  }

  if (!config.openApiEnabled && !config.swaggerUiEnabled) {
    blockDocsRoutes(app);
    logger.log('OpenAPI and Swagger UI disabled by configuration');
    return;
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Finenumbers HLR Lookup API')
    .setDescription(
      [
        'Public client API is under `/v1` and uses API key auth:',
        '`Authorization: Bearer fnk_live_<prefix>_<secret>`.',
        'Create endpoints accept optional `Idempotency-Key`.',
        'Errors always use `{ error: { code, message, requestId, details? } }`.',
        'Interactive Swagger UI is disabled in production.',
      ].join(' '),
    )
    .setVersion('1.0.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Session/JWT auth for internal cabinet/admin routes (when enabled)',
    })
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Key',
        description:
          'Public API key: `Authorization: Bearer fnk_live_<prefix>_<secret>`',
      },
      'ApiKey',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  if (config.openApiEnabled) {
    app.getHttpAdapter().get('/openapi.json', (_req, res) => {
      const response = res as {
        setHeader: (name: string, value: string) => void;
        end: (body: string) => void;
      };
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(document));
    });
  } else {
    blockPath(app, '/openapi.json');
  }

  if (config.swaggerUiEnabled) {
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: 'Finenumbers API (dev)',
    });
    logger.log(
      `OpenAPI: /openapi.json (contract); Swagger UI: http://localhost:${config.apiPort}/docs`,
    );
  } else {
    blockPath(app, '/docs');
    blockPath(app, '/docs-json');
    logger.log(
      config.openApiEnabled
        ? 'OpenAPI contract at /openapi.json; Swagger UI disabled'
        : 'OpenAPI and Swagger UI disabled',
    );
  }
}

function blockDocsRoutes(app: NestExpressApplication): void {
  for (const path of ['/docs', '/docs/', '/docs-json', '/openapi.json']) {
    blockPath(app, path);
  }
}

function blockPath(app: NestExpressApplication, path: string): void {
  app.getHttpAdapter().get(path, (_req, res) => {
    const response = res as {
      status: (code: number) => { end: (body?: string) => void };
      end: (body?: string) => void;
    };
    if (typeof response.status === 'function') {
      response.status(404).end('Not Found');
      return;
    }
    response.end('Not Found');
  });
}

void bootstrap();
