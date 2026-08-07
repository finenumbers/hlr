import { describe, expect, it } from 'vitest';

import {
  labelProviderRequestKind,
  labelProviderRequestStatus,
} from './status-labels';

const labels: Record<string, string> = {
  'common.dash': '—',
  'labels.providerRequestKind.SEND': 'Отправка',
  'labels.providerRequestKind.COST': 'Стоимость',
  'labels.providerRequestStatus.SUCCEEDED': 'Успех',
  'labels.providerRequestStatus.FAILED': 'Ошибка',
};

const t = (key: string) => labels[key] ?? key;

describe('labelProviderRequestKind', () => {
  it('maps known kinds', () => {
    expect(labelProviderRequestKind('SEND', t)).toBe('Отправка');
    expect(labelProviderRequestKind('COST', t)).toBe('Стоимость');
  });

  it('passes through unknown kinds', () => {
    expect(labelProviderRequestKind('WEIRD', t)).toBe('WEIRD');
  });

  it('uses dash for empty', () => {
    expect(labelProviderRequestKind(null, t)).toBe('—');
  });
});

describe('labelProviderRequestStatus', () => {
  it('maps known statuses', () => {
    expect(labelProviderRequestStatus('SUCCEEDED', t)).toBe('Успех');
    expect(labelProviderRequestStatus('FAILED', t)).toBe('Ошибка');
  });

  it('passes through unknown statuses', () => {
    expect(labelProviderRequestStatus('DEAD', t)).toBe('DEAD');
  });
});
