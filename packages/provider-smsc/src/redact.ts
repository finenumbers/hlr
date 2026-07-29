const SECRET_KEYS = new Set([
  'psw',
  'password',
  'passwd',
  'apikey',
  'api_key',
  'apiKey',
  'login',
  'md5',
  'sha1',
  'crc32',
  'token',
  'secret',
  'authorization',
  'signature',
]);

/**
 * Deep-clone JSON-ish values while redacting credential/signature fields.
 * Used for persistence + structured logs (phones stay intact here;
 * log sinks apply phone masking separately via sanitizeLogFields).
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.has(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSecrets(nested);
      }
    }
    return out;
  }
  return value;
}

export function toPhoneDigits(phoneE164: string): string {
  return phoneE164.trim().replace(/^\+/, '');
}
