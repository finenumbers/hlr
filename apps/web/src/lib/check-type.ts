export type CheckType = 'HLR' | 'PING';

export function isCheckType(value: unknown): value is CheckType {
  return value === 'HLR' || value === 'PING';
}

/** Display label for UI — never show raw PING; show Silent SMS. */
export function serviceLabel(
  checkType: string | null | undefined,
  t: (key: string) => string,
): string {
  if (checkType === 'PING') return t('common.servicePing');
  if (checkType === 'HLR') return t('common.serviceHlr');
  return checkType ? String(checkType) : t('common.dash');
}
