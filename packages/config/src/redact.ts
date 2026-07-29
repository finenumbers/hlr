const SECRET_KEY_PATTERN =
  /^(psw|password|passwd|secret|signing[_-]?secret|secret[_-]?hash|raw[_-]?key|raw[_-]?secret|token|authorization|api[_-]?key|apikey|pepper|cookie|session|md5|sha1|crc32|login|signature)$/i;

const PHONE_PATTERN = /\+?\d{10,15}/g;

/** API keys, webhook secrets, and auth headers that may appear in free-form text. */
const SECRET_IN_TEXT_PATTERN =
  /\b(?:fnk_(?:live|test)_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_-]+|(?:Bearer|Basic)\s+[A-Za-z0-9._\-+/=]+)/gi;

/**
 * Mask E.164 / digit phones for logs: +79991234567 → +7999***4567
 */
export function maskPhone(phone: string): string {
  const digits = phone.trim();
  if (digits.length < 8) {
    return '***';
  }
  const keepStart = Math.min(5, Math.floor(digits.length / 3));
  const keepEnd = 4;
  return `${digits.slice(0, keepStart)}***${digits.slice(-keepEnd)}`;
}

/** Mask phone-looking substrings inside free-form log messages. */
export function maskPhonesInText(text: string): string {
  return text.replace(PHONE_PATTERN, (match) => maskPhone(match));
}

/** Redact credential-looking substrings, then mask phones. */
export function redactSecretsInText(text: string): string {
  return maskPhonesInText(text.replace(SECRET_IN_TEXT_PATTERN, '[REDACTED]'));
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

/**
 * Deep-clone JSON-ish values while redacting credential fields and masking phones.
 */
export function sanitizeLogValue(value: unknown, keyHint?: string): unknown {
  if (keyHint && isSecretKey(keyHint)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    if (keyHint && /phone/i.test(keyHint)) {
      return maskPhone(value);
    }
    return redactSecretsInText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeLogValue(nested, key);
    }
    return out;
  }

  return value;
}

export function sanitizeLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeLogValue(fields) as Record<string, unknown>;
}
