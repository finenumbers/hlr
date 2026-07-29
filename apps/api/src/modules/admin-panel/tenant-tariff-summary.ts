export type TenantTariffSummaryRow = {
  checkType: 'HLR' | 'PING';
  tariffPlanId: string;
  tariffPlan: {
    code: string;
    name: string;
    checkType: 'HLR' | 'PING';
    isActive: boolean;
  };
};

/**
 * Admin tenant-list chip: only show assignments that are at least plan-active.
 * Full billable window (effectiveFrom/To) is resolved on tenant detail via inspect.
 */
export function mapTenantTariffsSummary(rows: TenantTariffSummaryRow[]) {
  const pick = (checkType: 'HLR' | 'PING') => {
    const row = rows.find(
      (r) => r.checkType === checkType && r.tariffPlan.isActive,
    );
    if (!row) {
      return null;
    }
    return {
      tariffPlanId: row.tariffPlanId,
      code: row.tariffPlan.code,
      name: row.tariffPlan.name,
    };
  };
  return {
    hlr: pick('HLR'),
    ping: pick('PING'),
  };
}
