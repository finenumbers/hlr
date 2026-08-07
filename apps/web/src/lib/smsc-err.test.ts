import { describe, expect, it } from 'vitest';

import {
  isSubmitTimeProviderFailure,
  providerItemErrorLabel,
  smscApiErrLabel,
  smscErrLabel,
} from './smsc-err';

const labels: Record<string, string> = {
  'smscApiErr.8': 'Невозможно доставить / проверить номер',
  'smscApiErr.1': 'Неверные параметры запроса',
  'smscApiErr.6': 'Запрещено провайдером',
  'smscErr.1': 'Абонент не существует',
  'smscErr.6': 'Абонент не в сети',
};

const t = (key: string) => labels[key] ?? key;

describe('smscApiErrLabel', () => {
  it('maps API codes 1–9', () => {
    expect(smscApiErrLabel('8', t)).toBe('Невозможно доставить / проверить номер');
    expect(smscApiErrLabel(1, t)).toBe('Неверные параметры запроса');
  });

  it('returns null for status-only codes', () => {
    expect(smscApiErrLabel('11', t)).toBeNull();
  });
});

describe('providerItemErrorLabel', () => {
  it('uses API label when preferApi (submit-time failure)', () => {
    expect(providerItemErrorLabel('8', t, { preferApi: true })).toBe(
      'Невозможно доставить / проверить номер',
    );
    expect(providerItemErrorLabel('1', t, { preferApi: true })).toBe(
      'Неверные параметры запроса',
    );
  });

  it('uses status err when not preferApi (callback result)', () => {
    expect(providerItemErrorLabel('1', t)).toBe('Абонент не существует');
    expect(providerItemErrorLabel('6', t)).toBe('Абонент не в сети');
  });

  it('keeps unknown codes as digits', () => {
    expect(providerItemErrorLabel('999', t)).toBe('999');
  });
});

describe('isSubmitTimeProviderFailure', () => {
  it('detects FAILED with empty result', () => {
    expect(
      isSubmitTimeProviderFailure({ status: 'FAILED', resultStatus: null }),
    ).toBe(true);
    expect(
      isSubmitTimeProviderFailure({ status: 'FAILED', resultStatus: 'unreachable' }),
    ).toBe(false);
  });
});

describe('smscErrLabel', () => {
  it('maps status err codes', () => {
    expect(smscErrLabel('1', t)).toBe('Абонент не существует');
  });
});
