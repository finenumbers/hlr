import { describe, expect, it } from 'vitest';

import {
  redactLedgerMetadataForClient,
  sanitizeClientErrorText,
  toCabinetJobView,
  toCabinetSellEstimate,
} from './cabinet-client-view';

describe('cabinet-client-view', () => {
  it('strips provider cost from estimate', () => {
    const view = toCabinetSellEstimate({
      tenantId: 't1',
      checkType: 'HLR',
      unitCount: 2,
      unitSellPrice: '1.5',
      unitProviderCost: '0.4',
      estimatedSellTotal: '3.0',
      estimatedProviderTotal: '0.8',
      currency: 'RUB',
      tariff: {
        tariffPlanId: 'plan1',
        tariffPlanCode: 'STD',
        tenantTariffId: 'tt1',
        currency: 'RUB',
        checkType: 'HLR',
        sellPrice: '1.5',
        providerCost: '0.4',
        source: 'tenant_plan',
      },
    });

    expect(view).toEqual({
      tenantId: 't1',
      checkType: 'HLR',
      unitCount: 2,
      unitSellPrice: '1.5',
      estimatedSellTotal: '3.0',
      currency: 'RUB',
      tariff: {
        tariffPlanId: 'plan1',
        tariffPlanCode: 'STD',
        currency: 'RUB',
        checkType: 'HLR',
        sellPrice: '1.5',
      },
    });
    expect(JSON.stringify(view)).not.toContain('provider');
  });

  it('strips provider snapshot from job create view', () => {
    const view = toCabinetJobView({
      id: 'j1',
      checkType: 'PING',
      source: 'BULK',
      status: 'QUEUED',
      itemCount: 1,
      successCount: 0,
      failureCount: 0,
      estimatedCost: '2',
      actualCost: null,
      currency: 'RUB',
      errorCode: 'CSV_EMPTY',
      errorMessage: 'SMSC callback failed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      unitSellPrice: '2',
      unitProviderCost: '0.5',
      tariffPlanId: 'plan1',
      tariffPlanCode: 'PING1',
    });

    expect(view.unitSellPrice).toBe('2');
    expect(view.errorCode).toBe('CSV_EMPTY');
    expect(view.errorMessage).toBe('провайдер callback failed');
    expect(view).not.toHaveProperty('unitProviderCost');
    expect(view).not.toHaveProperty('tariffPlanId');
    expect(JSON.stringify(view)).not.toContain('0.5');
    expect(JSON.stringify(view)).not.toMatch(/SMSC/i);
  });

  it('sanitizes SMSC brand from client error text', () => {
    expect(sanitizeClientErrorText('SMSC.ru timeout')).toBe('провайдер timeout');
    expect(sanitizeClientErrorText('SMSC.ru timeout', 'en')).toBe('provider timeout');
  });

  it('redacts provider fields from ledger metadata', () => {
    const meta = redactLedgerMetadataForClient({
      jobId: 'j1',
      jobItemId: 'i1',
      phoneE164: '+7999',
      checkType: 'HLR',
      sellPrice: '1.5',
      providerCost: '0.4',
      tariffPlanId: 'plan1',
      tariffPlanCode: 'STD',
      tenantTariffId: 'tt1',
      source: 'tenant_plan',
      priceSource: 'job_snapshot',
    });

    expect(meta).toEqual({
      jobId: 'j1',
      jobItemId: 'i1',
      phoneE164: '+7999',
      checkType: 'HLR',
      sellPrice: '1.5',
      tariffPlanId: 'plan1',
      tariffPlanCode: 'STD',
    });
  });
});
