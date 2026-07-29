import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';
import { redactSecretsInText, sanitizeLogFields } from '@finenumbers/config';

import { AppConfigService } from '../config/app-config.service';
import { RequestContextService } from '../request-context/request-context.service';

type LogFields = Record<string, unknown>;

/**
 * Structured JSON logger. Emits one JSON object per line with request context when present.
 * Secrets/phones are sanitized before write.
 */
@Injectable()
export class AppLogger extends ConsoleLogger {
  constructor(
    private readonly requestContext: RequestContextService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  override log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  override error(message: unknown, stackOrContext?: string, context?: string): void {
    if (context !== undefined) {
      this.write('error', message, context, { stack: stackOrContext });
      return;
    }
    this.write('error', message, stackOrContext);
  }

  override warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  override debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  override verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  child(context: string): AppLogger {
    const logger = new AppLogger(this.requestContext, this.config);
    logger.setContext(context);
    return logger;
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    extra: LogFields = {},
  ): void {
    const payload: LogFields = {
      level,
      time: new Date().toISOString(),
      service: 'api',
      env: this.config.nodeEnv,
      context: context ?? this.context,
      message:
        typeof message === 'string' ? redactSecretsInText(message) : undefined,
      ...sanitizeLogFields(extra),
    };

    if (typeof message !== 'string') {
      payload.data = sanitizeLogFields(
        message && typeof message === 'object'
          ? (message as LogFields)
          : { value: message },
      );
    }

    const store = this.requestContext.getStore();
    if (store) {
      payload.requestId = store.requestId;
      if (store.userId) {
        payload.userId = store.userId;
      }
      if (store.tenantId) {
        payload.tenantId = store.tenantId;
      }
    }

    // Intentionally use stdout/stderr directly for machine-parseable lines.
    const line = JSON.stringify(payload);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
      return;
    }
    process.stdout.write(`${line}\n`);
  }
}
