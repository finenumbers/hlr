'use client';

import { useQuery } from '@tanstack/react-query';

import { ProductSubmitPanel } from '@/components/cabinet/product-submit-panel';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { api } from '@/lib/api/client';
import type { CheckType } from '@/lib/check-type';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';

export function ProductSubmitPage({ checkType }: { checkType: CheckType }) {
  const t = useT();
  const { tenantId } = useAuth();
  const tariff = useQuery({
    queryKey: ['cabinet', 'tariff', tenantId],
    queryFn: () => api.cabinet.tariff(),
    enabled: Boolean(tenantId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const quote = checkType === 'HLR' ? (tariff.data?.hlr ?? null) : (tariff.data?.ping ?? null);
  const title =
    checkType === 'HLR' ? t('cabinetSubmit.hlrTitle') : t('cabinetSubmit.pingTitle');
  const description =
    checkType === 'HLR' ? t('cabinetSubmit.hlrDescription') : t('cabinetSubmit.pingDescription');

  return (
    <div>
      <PageHeader title={title} description={description} />
      <QueryState
        isLoading={tariff.isLoading || !tenantId}
        isError={tariff.isError}
        error={tariff.error}
        onRetry={() => void tariff.refetch()}
      >
        <ProductSubmitPanel
          checkType={checkType}
          available={Boolean(quote)}
          sellPrice={quote?.sellPrice ?? null}
          currency={quote?.currency ?? 'RUB'}
          compactTitle
        />
      </QueryState>
    </div>
  );
}
