import { describe, expect, it, vi } from 'vitest';

import { CabinetService } from './cabinet.service';

/**
 * Cabinet availability = quoteProducts projection (null per missing/invalid product).
 * Covers the four assignment states as the client UI / getTariff contract.
 */
describe('CabinetService.getTariff availability matrix', () => {
  function createService(quotes: {
    hlr: null | {
      checkType: 'HLR';
      tariffPlanId: string;
      tariffPlanCode: string;
      tariffPlanName: string;
      currency: string;
      unitSellPrice: string;
      unitProviderCost: string;
    };
    ping: null | {
      checkType: 'PING';
      tariffPlanId: string;
      tariffPlanCode: string;
      tariffPlanName: string;
      currency: string;
      unitSellPrice: string;
      unitProviderCost: string;
    };
  }) {
    const billing = {
      quoteProducts: vi.fn(async () => quotes),
    };
    const service = Object.create(CabinetService.prototype) as CabinetService;
    Object.assign(service, { billing });
    return { service, billing };
  }

  it.each([
    {
      state: 'none',
      quotes: { hlr: null, ping: null },
      expectHlr: false,
      expectPing: false,
    },
    {
      state: 'hlr-only',
      quotes: {
        hlr: {
          checkType: 'HLR' as const,
          tariffPlanId: 'p1',
          tariffPlanCode: 'H1',
          tariffPlanName: 'HLR',
          currency: 'RUB',
          unitSellPrice: '1.5',
          unitProviderCost: '0.4',
        },
        ping: null,
      },
      expectHlr: true,
      expectPing: false,
    },
    {
      state: 'ping-only',
      quotes: {
        hlr: null,
        ping: {
          checkType: 'PING' as const,
          tariffPlanId: 'p2',
          tariffPlanCode: 'P1',
          tariffPlanName: 'Ping',
          currency: 'RUB',
          unitSellPrice: '2.5',
          unitProviderCost: '0.8',
        },
      },
      expectHlr: false,
      expectPing: true,
    },
    {
      state: 'both',
      quotes: {
        hlr: {
          checkType: 'HLR' as const,
          tariffPlanId: 'p1',
          tariffPlanCode: 'H1',
          tariffPlanName: 'HLR',
          currency: 'RUB',
          unitSellPrice: '1.5',
          unitProviderCost: '0.4',
        },
        ping: {
          checkType: 'PING' as const,
          tariffPlanId: 'p2',
          tariffPlanCode: 'P1',
          tariffPlanName: 'Ping',
          currency: 'RUB',
          unitSellPrice: '2.5',
          unitProviderCost: '0.8',
        },
      },
      expectHlr: true,
      expectPing: true,
    },
  ])('state=$state: getTariff sell-only slots', async ({ quotes, expectHlr, expectPing }) => {
    const { service } = createService(quotes);
    const view = await service.getTariff('tenant-1');

    expect(Boolean(view.hlr)).toBe(expectHlr);
    expect(Boolean(view.ping)).toBe(expectPing);

    if (view.hlr) {
      expect(view.hlr).toEqual({
        checkType: 'HLR',
        tariffPlanId: 'p1',
        code: 'H1',
        name: 'HLR',
        currency: 'RUB',
        sellPrice: '1.5',
      });
      expect(view.hlr).not.toHaveProperty('unitProviderCost');
      expect(JSON.stringify(view.hlr)).not.toContain('provider');
    }
    if (view.ping) {
      expect(view.ping.sellPrice).toBe('2.5');
      expect(view.ping.code).toBe('P1');
      expect(JSON.stringify(view.ping)).not.toContain('0.8');
    }
  });
});
