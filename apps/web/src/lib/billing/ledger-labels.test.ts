import { describe, expect, it } from 'vitest';

import {
  formatCabinetLedgerDescription,
  formatCabinetLedgerType,
} from './ledger-labels';

const messages: Record<string, string> = {
  'cabinetBilling.types.HOLD': 'Резерв',
  'cabinetBilling.types.CREDIT': 'Пополнение',
  'cabinetBilling.descriptions.reserveHLR': 'Резерв под проверку HLR',
  'cabinetBilling.descriptions.reservePING': 'Резерв под проверку Silent SMS',
  'cabinetBilling.descriptions.capture': 'Списание из резерва',
  'cabinetBilling.descriptions.releasePartial':
    'Возврат неиспользованного остатка резерва',
  'cabinetBilling.descriptions.release': 'Возврат резерва',
  'cabinetBilling.descriptions.jobItemRelease': 'Возврат резерва по проверке',
  'cabinetBilling.descriptions.manualTopup': 'Ручное пополнение',
  'cabinetBilling.descriptions.manualAdjustmentCredit':
    'Ручная корректировка (зачисление)',
  'cabinetBilling.descriptions.manualAdjustmentDebit':
    'Ручная корректировка (списание)',
};

const t = (key: string) => messages[key] ?? key;

describe('formatCabinetLedgerType', () => {
  it('maps known types', () => {
    expect(formatCabinetLedgerType(t, 'HOLD')).toBe('Резерв');
    expect(formatCabinetLedgerType(t, 'CREDIT')).toBe('Пополнение');
  });

  it('passes through unknown types', () => {
    expect(formatCabinetLedgerType(t, 'OTHER')).toBe('OTHER');
  });
});

describe('formatCabinetLedgerDescription', () => {
  it('maps known English templates', () => {
    expect(formatCabinetLedgerDescription(t, 'Reserve for HLR check')).toBe(
      'Резерв под проверку HLR',
    );
    expect(formatCabinetLedgerDescription(t, 'Reserve for PING check')).toBe(
      'Резерв под проверку Silent SMS',
    );
    expect(formatCabinetLedgerDescription(t, 'Capture reserved funds')).toBe(
      'Списание из резерва',
    );
    expect(formatCabinetLedgerDescription(t, 'job_item_failed')).toBe(
      'Возврат резерва по проверке',
    );
    expect(formatCabinetLedgerDescription(t, 'Manual adjustment (credit)')).toBe(
      'Ручная корректировка (зачисление)',
    );
  });

  it('keeps custom admin text', () => {
    expect(formatCabinetLedgerDescription(t, 'Счёт №12')).toBe('Счёт №12');
  });

  it('returns null for empty', () => {
    expect(formatCabinetLedgerDescription(t, null)).toBeNull();
    expect(formatCabinetLedgerDescription(t, '')).toBeNull();
  });
});
