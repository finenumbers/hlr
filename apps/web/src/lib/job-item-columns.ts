type Translate = (key: string, params?: Record<string, string | number>) => string;
type Row = Record<string, unknown>;

export type JobItemColumn = {
  key: string;
  header: string;
  cell: (row: Row) => string;
};

function dash(t: Translate): string {
  return t('common.dash');
}

function text(t: Translate, value: unknown): string {
  if (value == null || value === '') return dash(t);
  return String(value);
}

function boolText(t: Translate, value: unknown): string {
  if (value == null) return dash(t);
  return String(value);
}

function mccMnc(t: Translate, row: Row): string {
  if (row.mcc == null && row.mnc == null) return dash(t);
  return `${row.mcc ?? '—'}/${row.mnc ?? '—'}`;
}

/** Shared result columns for cabinet/admin job item tables. */
export function jobItemResultColumns(
  t: Translate,
  opts: { prefix: 'cabinetJobs' | 'adminJobs'; includeHlr: boolean; includeError?: boolean },
): JobItemColumn[] {
  const p = opts.prefix;
  const cols: JobItemColumn[] = [
    { key: 'phone', header: t(`${p}.colPhone`), cell: (r) => text(t, r.phoneE164) },
    { key: 'status', header: t(`${p}.colStatus`), cell: (r) => text(t, r.status) },
    { key: 'result', header: t(`${p}.colResult`), cell: (r) => text(t, r.resultStatus) },
    { key: 'reachable', header: t(`${p}.colReachable`), cell: (r) => boolText(t, r.isReachable) },
  ];

  if (opts.includeHlr) {
    cols.push(
      { key: 'operator', header: t(`${p}.colOperator`), cell: (r) => text(t, r.operatorName) },
      { key: 'country', header: t(`${p}.colCountry`), cell: (r) => text(t, r.countryCode) },
      { key: 'region', header: t(`${p}.colRegion`), cell: (r) => text(t, r.region) },
      { key: 'mccmnc', header: t(`${p}.colMccMnc`), cell: (r) => mccMnc(t, r) },
      { key: 'imsi', header: t(`${p}.colImsi`), cell: (r) => text(t, r.imsi) },
      { key: 'msc', header: t(`${p}.colMsc`), cell: (r) => text(t, r.msc) },
      { key: 'roaming', header: t(`${p}.colRoaming`), cell: (r) => boolText(t, r.roaming) },
      {
        key: 'roamingCountry',
        header: t(`${p}.colRoamingCountry`),
        cell: (r) => text(t, r.roamingCountry),
      },
      {
        key: 'roamingOperator',
        header: t(`${p}.colRoamingOperator`),
        cell: (r) => text(t, r.roamingOperator),
      },
    );
  }

  if (opts.includeError) {
    cols.push({
      key: 'error',
      header: t(`${p}.colError`),
      cell: (r) => text(t, r.errorMessage),
    });
  }

  return cols;
}

/** CSV field names for HLR extras (aligned with listItems API). */
export const HLR_CSV_EXTRA_FIELDS = [
  'operatorName',
  'countryCode',
  'region',
  'mcc',
  'mnc',
  'imsi',
  'msc',
  'roaming',
  'roamingCountry',
  'roamingOperator',
] as const;
