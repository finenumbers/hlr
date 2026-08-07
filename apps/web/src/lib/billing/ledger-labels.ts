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

/** Localized wallet transaction type label for cabinet billing. */
export function formatCabinetLedgerType(t: Translate, type: string): string {
  if (isLedgerType(type)) {
    return t(`cabinetBilling.types.${type}`);
  }
  return type;
}

/**
 * Localized ledger description. Known English backend templates are mapped;
 * custom admin text is shown as-is.
 */
export function formatCabinetLedgerDescription(
  t: Translate,
  description: string | null | undefined,
): string | null {
  if (description == null || description === '') return null;
  const text = description.trim();

  const reserve = /^Reserve for (HLR|PING) check$/.exec(text);
  if (reserve) {
    return t(`cabinetBilling.descriptions.reserve${reserve[1]}`);
  }

  if (text === 'Capture reserved funds') {
    return t('cabinetBilling.descriptions.capture');
  }
  if (text === 'Release unused reserved funds after partial capture') {
    return t('cabinetBilling.descriptions.releasePartial');
  }
  if (text === 'Release reserved funds') {
    return t('cabinetBilling.descriptions.release');
  }
  if (text === 'Manual top-up') {
    return t('cabinetBilling.descriptions.manualTopup');
  }

  const adjustment = /^Manual adjustment \((credit|debit)\)$/i.exec(text);
  if (adjustment) {
    const dir = adjustment[1]!.toLowerCase();
    return t(
      dir === 'credit'
        ? 'cabinetBilling.descriptions.manualAdjustmentCredit'
        : 'cabinetBilling.descriptions.manualAdjustmentDebit',
    );
  }

  if (/^job_item_/i.test(text)) {
    return t('cabinetBilling.descriptions.jobItemRelease');
  }

  return text;
}
