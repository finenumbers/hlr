import { describe, expect, it } from 'vitest';

import {
  formatLedgerDescription,
  formatLedgerType,
} from './ledger-labels';

const labels: Record<string, string> = {
  'ledger.types.HOLD': 'Резерв',
  'ledger.types.CREDIT': 'Пополнение',
  'ledger.descriptions.reserveHLR': 'Резерв под проверку HLR',
  'ledger.descriptions.reservePING': 'Резерв под проверку Silent SMS',
  'ledger.descriptions.capture': 'Списание из резерва',
  'ledger.descriptions.releasePartial':
    'Возврат неиспользованного остатка резерва',
  'ledger.descriptions.release': 'Возврат резерва',
  'ledger.descriptions.jobItemRelease': 'Возврат резерва по проверке',
  'ledger.descriptions.manualTopup': 'Ручное пополнение',
  'ledger.descriptions.manualAdjustmentCredit':
    'Ручная корректировка (зачисление)',
  'ledger.descriptions.manualAdjustmentDebit':
    'Ручная корректировка (списание)',
};

const t = (key: string) => labels[key] ?? key;

describe('formatLedgerType', () => {
  it('maps known types', () => {
    expect(formatLedgerType(t, 'HOLD')).toBe('Резерв');
    expect(formatLedgerType(t, 'CREDIT')).toBe('Пополнение');
  });

  it('passes through unknown types', () => {
    expect(formatLedgerType(t, 'OTHER')).toBe('OTHER');
  });
});

describe('formatLedgerDescription', () => {
  it('maps known English templates', () => {
    expect(formatLedgerDescription(t, 'Reserve for HLR check')).toBe(
      'Резерв под проверку HLR',
    );
    expect(formatLedgerDescription(t, 'Reserve for PING check')).toBe(
      'Резерв под проверку Silent SMS',
    );
    expect(formatLedgerDescription(t, 'Capture reserved funds')).toBe(
      'Списание из резерва',
    );
    expect(formatLedgerDescription(t, 'job_item_failed')).toBe(
      'Возврат резерва по проверке',
    );
    expect(formatLedgerDescription(t, 'Manual adjustment (credit)')).toBe(
      'Ручная корректировка (зачисление)',
    );
  });

  it('keeps custom admin text', () => {
    expect(formatLedgerDescription(t, 'Счёт №12')).toBe('Счёт №12');
  });

  it('returns null for empty', () => {
    expect(formatLedgerDescription(t, null)).toBeNull();
    expect(formatLedgerDescription(t, '')).toBeNull();
  });
});
