type Translate = (key: string, params?: Record<string, string | number>) => string;

const LEDGER_TYPES = [
  'CREDIT',
  'DEBIT',
  'HOLD',
  'RELEASE',
  'ADJUSTMENT',
] as const;

type LedgerType = (typeof LEDGER_TYPES)[number];

function isLedgerType(value: string): value is LedgerType {
  return (LEDGER_TYPES as readonly string[]).includes(value);
}

/** Localized wallet transaction type label (cabinet + admin). */
export function formatLedgerType(t: Translate, type: string): string {
  if (isLedgerType(type)) {
    return t(`ledger.types.${type}`);
  }
  return type;
}

/**
 * Localized ledger description. Known English backend templates are mapped;
 * custom admin text is shown as-is.
 */
export function formatLedgerDescription(
  t: Translate,
  description: string | null | undefined,
): string | null {
  if (description == null || description === '') return null;
  const text = description.trim();

  const reserve = /^Reserve for (HLR|PING) check$/.exec(text);
  if (reserve) {
    return t(`ledger.descriptions.reserve${reserve[1]}`);
  }

  if (text === 'Capture reserved funds') {
    return t('ledger.descriptions.capture');
  }
  if (text === 'Release unused reserved funds after partial capture') {
    return t('ledger.descriptions.releasePartial');
  }
  if (text === 'Release reserved funds') {
    return t('ledger.descriptions.release');
  }
  if (text === 'Manual top-up') {
    return t('ledger.descriptions.manualTopup');
  }

  const adjustment = /^Manual adjustment \((credit|debit)\)$/i.exec(text);
  if (adjustment) {
    const dir = adjustment[1]!.toLowerCase();
    return t(
      dir === 'credit'
        ? 'ledger.descriptions.manualAdjustmentCredit'
        : 'ledger.descriptions.manualAdjustmentDebit',
    );
  }

  if (/^job_item_/i.test(text)) {
    return t('ledger.descriptions.jobItemRelease');
  }

  return text;
}
