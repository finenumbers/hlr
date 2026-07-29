'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { ProductSubmitPanel } from '@/components/cabinet/product-submit-panel';
import { PageHeader } from '@/components/data/page-header';
import { QueryState } from '@/components/data/query-state';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/auth-context';
import { useT } from '@/lib/i18n';

/** Overview of both products; dedicated pages live under /submit/hlr and /submit/ping. */
export default function SubmitOverviewPage() {
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

  const hlr = tariff.data?.hlr ?? null;
  const ping = tariff.data?.ping ?? null;

  return (
    <div>
      <PageHeader
        title={t('cabinetSubmit.title')}
        description={t('cabinetSubmit.description')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/submit/hlr">
              <Button type="button" variant="secondary" size="sm">
                {t('cabinetSubmit.optionHlr')}
              </Button>
            </Link>
            <Link href="/app/submit/ping">
              <Button type="button" variant="secondary" size="sm">
                {t('cabinetSubmit.optionPing')}
              </Button>
            </Link>
          </div>
        }
      />
      <QueryState
        isLoading={tariff.isLoading || !tenantId}
        isError={tariff.isError}
        error={tariff.error}
        onRetry={() => void tariff.refetch()}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <ProductSubmitPanel
            checkType="HLR"
            available={Boolean(hlr)}
            sellPrice={hlr?.sellPrice ?? null}
            currency={hlr?.currency ?? 'RUB'}
          />
          <ProductSubmitPanel
            checkType="PING"
            available={Boolean(ping)}
            sellPrice={ping?.sellPrice ?? null}
            currency={ping?.currency ?? 'RUB'}
          />
        </div>
      </QueryState>
    </div>
  );
}
