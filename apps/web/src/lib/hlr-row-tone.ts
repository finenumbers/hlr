import { hlrRowTone, type HlrRowTone } from '@finenumbers/provider-core';

const ROW_CLASS: Record<HlrRowTone, string> = {
  success:
    'bg-[color-mix(in_oklab,var(--color-ok)_14%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-ok)_22%,transparent)]',
  fail: 'bg-[color-mix(in_oklab,var(--color-danger)_12%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)]',
  error:
    'bg-[color-mix(in_oklab,var(--color-warn)_16%,transparent)] hover:bg-[color-mix(in_oklab,var(--color-warn)_24%,transparent)]',
};

/** CSS class for HLR result row background, or undefined when no tone. */
export function hlrResultRowClassName(row: {
  resultStatus?: unknown;
  status?: unknown;
}): string | undefined {
  const tone = hlrRowTone({
    resultStatus:
      row.resultStatus == null || row.resultStatus === ''
        ? null
        : String(row.resultStatus),
    status: row.status == null ? null : String(row.status),
  });
  return tone ? ROW_CLASS[tone] : undefined;
}
