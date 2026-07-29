import { sanitizeLogFields, redactSecretsInText } from '@finenumbers/config';
import type { JobsLogger } from '@finenumbers/jobs';
import type { ProviderLogger } from '@finenumbers/provider-core';

function write(
  level: string,
  message: string,
  fields?: Record<string, unknown>,
): void {
  const safeFields = fields ? sanitizeLogFields(fields) : undefined;
  const line = JSON.stringify({
    level,
    msg: redactSecretsInText(message),
    service: 'worker',
    ts: new Date().toISOString(),
    ...safeFields,
  });
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const workerLogger: JobsLogger & ProviderLogger = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields),
};
