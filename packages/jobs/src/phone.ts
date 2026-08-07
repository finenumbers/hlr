import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

import { JobsValidationError } from './types.js';

export type NormalizePhonesResult = {
  /** Unique E.164 numbers in first-seen order. */
  phones: string[];
  /** Count of inputs that collapsed into an already-seen E.164. */
  deduplicatedCount: number;
  /** Original inputs that could not be normalized. */
  invalid: Array<{ input: string; reason: string }>;
};

/**
 * RU mobile for HLR/PING pilot: exactly 11 digits starting with 79 (+79XXXXXXXXX).
 */
export function isRuMobile79(e164: string): boolean {
  const digits = e164.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('79');
}

/** Count numbers that are not RU mobile 79… (after E.164 normalization). */
export function countNonRuMobile79Phones(phones: string[]): number {
  let count = 0;
  for (const phone of phones) {
    if (!isRuMobile79(phone)) count += 1;
  }
  return count;
}

/**
 * @deprecated Prefer countNonRuMobile79Phones for HLR/PING gate.
 * Count E.164 numbers classified as fixed-line (landline).
 */
export function countNonMobilePhones(phones: string[]): number {
  return countNonRuMobile79Phones(phones);
}

export const RU_MOBILE_79_REQUIRED_MESSAGE =
  'В списке для проверки есть номера, проверка которых не может быть гарантирована HLR Lookup на мобильных сетях';

/**
 * Normalize a single phone to E.164.
 * Accepts numbers with or without `+`; optional default country for national formats.
 */
export function normalizePhoneE164(
  input: string,
  defaultCountry: CountryCode = 'RU',
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new JobsValidationError('Phone number is empty', { input });
  }

  const withPlus =
    trimmed.startsWith('+') || /^\d{8,15}$/.test(trimmed.replace(/[\s()-]/g, ''))
      ? trimmed.startsWith('+')
        ? trimmed
        : `+${trimmed.replace(/[\s()-]/g, '')}`
      : trimmed;

  const parsed = parsePhoneNumberFromString(withPlus, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw new JobsValidationError('Invalid phone number', { input });
  }
  return parsed.format('E.164');
}

/**
 * Normalize + validate + dedupe a list of phones.
 * Invalid numbers are collected (not thrown) so callers can fail the whole request
 * or surface partial errors — CreateJob fails if any invalid remain.
 */
export function normalizeAndDeduplicatePhones(
  inputs: string[],
  defaultCountry: CountryCode = 'RU',
): NormalizePhonesResult {
  const phones: string[] = [];
  const seen = new Set<string>();
  let deduplicatedCount = 0;
  const invalid: NormalizePhonesResult['invalid'] = [];

  for (const input of inputs) {
    try {
      const e164 = normalizePhoneE164(input, defaultCountry);
      if (seen.has(e164)) {
        deduplicatedCount += 1;
        continue;
      }
      seen.add(e164);
      phones.push(e164);
    } catch (error) {
      invalid.push({
        input,
        reason: error instanceof Error ? error.message : 'Invalid phone number',
      });
    }
  }

  return { phones, deduplicatedCount, invalid };
}

/** Split an array into fixed-size batches (last batch may be smaller). */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    throw new JobsValidationError('Batch size must be positive', { size });
  }
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
