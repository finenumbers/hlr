import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TariffsService } from './tariffs.service';

describe('TariffsService.assignToTenant (admin dual products)', () => {
  const tenantId = 'tenant-1';
  const hlrPlan = {
    id: 'plan-hlr',
    code: 'hlr-a',
    checkType: 'HLR' as const,
    isActive: true,
  };
  const pingPlan = {
    id: 'plan-ping',
    code: 'ping-a',
    checkType: 'PING' as const,
    isActive: true,
  };

  let prisma: {
    tenant: { findUnique: ReturnType<typeof vi.fn> };
    tariffPlan: { findUnique: ReturnType<typeof vi.fn> };
    tenantTariff: {
      findUnique: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  let audit: { write: ReturnType<typeof vi.fn> };
  let service: TariffsService;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: vi.fn(async () => ({ id: tenantId })) },
      tariffPlan: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          if (where.id === hlrPlan.id) return hlrPlan;
          if (where.id === pingPlan.id) return pingPlan;
          return null;
        }),
      },
      tenantTariff: {
        findUnique: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
        upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => ({
          id: 'tt-1',
          tenantId,
          checkType: create.checkType,
          tariffPlanId: create.tariffPlanId,
          priceOverride: create.priceOverride ?? null,
        })),
      },
    };
    audit = { write: vi.fn(async () => undefined) };
    service = new TariffsService(prisma as never, audit as never);
  });

  it('assigns HLR and Ping independently', async () => {
    await service.assignToTenant({
      tenantId,
      checkType: 'HLR',
      tariffPlanId: hlrPlan.id,
    });
    await service.assignToTenant({
      tenantId,
      checkType: 'PING',
      tariffPlanId: pingPlan.id,
    });

    expect(prisma.tenantTariff.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tenantTariff.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { tenantId_checkType: { tenantId, checkType: 'HLR' } },
      }),
    );
    expect(prisma.tenantTariff.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { tenantId_checkType: { tenantId, checkType: 'PING' } },
      }),
    );
  });

  it('rejects assigning an HLR plan into the Ping slot (regression)', async () => {
    await expect(
      service.assignToTenant({
        tenantId,
        checkType: 'PING',
        tariffPlanId: hlrPlan.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.tenantTariff.upsert).not.toHaveBeenCalled();
  });

  it('rejects assigning a Ping plan into the HLR slot (regression)', async () => {
    await expect(
      service.assignToTenant({
        tenantId,
        checkType: 'HLR',
        tariffPlanId: pingPlan.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('unassigns a product without touching the other slot', async () => {
    prisma.tenantTariff.findUnique.mockResolvedValueOnce({
      id: 'tt-hlr',
      tenantId,
      checkType: 'HLR',
      tariffPlanId: hlrPlan.id,
    });

    const result = await service.assignToTenant({
      tenantId,
      checkType: 'HLR',
      tariffPlanId: null,
    });

    expect(result.tariffPlanId).toBeNull();
    expect(prisma.tenantTariff.delete).toHaveBeenCalledWith({ where: { id: 'tt-hlr' } });
    expect(prisma.tenantTariff.upsert).not.toHaveBeenCalled();
  });

  it('404 when tenant missing', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.assignToTenant({
        tenantId: 'missing',
        checkType: 'HLR',
        tariffPlanId: hlrPlan.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
