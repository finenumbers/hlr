import { describe, expect, it } from 'vitest';

import { mapTenantTariffsSummary } from './tenant-tariff-summary';

describe('mapTenantTariffsSummary', () => {
  it('covers four assignment states for list chips', () => {
    expect(mapTenantTariffsSummary([])).toEqual({ hlr: null, ping: null });

    expect(
      mapTenantTariffsSummary([
        {
          checkType: 'HLR',
          tariffPlanId: 'p1',
          tariffPlan: { code: 'H1', name: 'HLR', checkType: 'HLR', isActive: true },
        },
      ]),
    ).toEqual({
      hlr: { tariffPlanId: 'p1', code: 'H1', name: 'HLR' },
      ping: null,
    });

    expect(
      mapTenantTariffsSummary([
        {
          checkType: 'PING',
          tariffPlanId: 'p2',
          tariffPlan: { code: 'P1', name: 'Ping', checkType: 'PING', isActive: true },
        },
      ]).hlr,
    ).toBeNull();

    const both = mapTenantTariffsSummary([
      {
        checkType: 'HLR',
        tariffPlanId: 'p1',
        tariffPlan: { code: 'H1', name: 'HLR', checkType: 'HLR', isActive: true },
      },
      {
        checkType: 'PING',
        tariffPlanId: 'p2',
        tariffPlan: { code: 'P1', name: 'Ping', checkType: 'PING', isActive: true },
      },
    ]);
    expect(both.hlr?.code).toBe('H1');
    expect(both.ping?.code).toBe('P1');
  });

  it('hides inactive plan on list (regression vs billable inspect)', () => {
    const summary = mapTenantTariffsSummary([
      {
        checkType: 'HLR',
        tariffPlanId: 'p1',
        tariffPlan: { code: 'dead', name: 'Dead', checkType: 'HLR', isActive: false },
      },
      {
        checkType: 'PING',
        tariffPlanId: 'p2',
        tariffPlan: { code: 'live', name: 'Live', checkType: 'PING', isActive: true },
      },
    ]);
    expect(summary.hlr).toBeNull();
    expect(summary.ping?.code).toBe('live');
  });
});
