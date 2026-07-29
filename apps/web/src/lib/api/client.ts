import type { AuthUser } from '@/lib/auth/permissions';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const TOKEN_KEY = 'fn.session.token';
const TENANT_KEY = 'fn.session.tenantId';

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getTenantId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TENANT_KEY);
}

export function setTenantId(tenantId: string | null): void {
  if (typeof window === 'undefined') return;
  if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
  else localStorage.removeItem(TENANT_KEY);
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  tenantId?: string | null;
  auth?: boolean;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.auth !== false) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const tenantId = options.tenantId === undefined ? getTenantId() : options.tenantId;
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const err = data as { error?: { message?: string; code?: string; details?: unknown } } | null;
    throw new ApiError(
      err?.error?.message ?? `Request failed (${res.status})`,
      res.status,
      err?.error?.code,
      err?.error?.details,
    );
  }

  return data as T;
}

export type LoginResponse = {
  accessToken: string;
  expiresAt: string;
  user: AuthUser;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export const api = {
  login: (email: string, password: string) =>
    apiRequest<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),
  logout: () => apiRequest<{ ok: true }>('/auth/logout', { method: 'POST', auth: false }),
  me: () => apiRequest<AuthUser>('/auth/me'),

  admin: {
    dashboard: () => apiRequest<Record<string, unknown>>('/admin/dashboard'),
    tenants: (q: string) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/tenants?${q}`),
    tenant: (id: string) => apiRequest<Record<string, unknown>>(`/admin/tenants/${id}`),
    updateTenantStatus: (id: string, status: string) =>
      apiRequest(`/admin/tenants/${id}`, { method: 'PATCH', body: { status } }),
    assignTariff: (id: string, body: { tariffPlanId: string }) =>
      apiRequest(`/admin/tenants/${id}/tariff`, { method: 'POST', body }),
    jobs: (q: string) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/jobs?${q}`),
    job: (id: string) => apiRequest<Record<string, unknown>>(`/admin/jobs/${id}`),
    jobItems: (id: string, q: string) =>
      apiRequest<Paginated<Record<string, unknown>>>(`/admin/jobs/${id}/items?${q}`),
    wallet: (tenantId: string) =>
      apiRequest<Record<string, unknown>>(`/admin/billing/wallets/${tenantId}`),
    ledger: (tenantId: string) =>
      apiRequest<unknown[]>(`/admin/billing/wallets/${tenantId}/ledger`),
    topup: (body: {
      tenantId: string;
      amount: string;
      idempotencyKey: string;
      description?: string;
    }) => apiRequest('/admin/billing/topup', { method: 'POST', body }),
    adjust: (body: {
      tenantId: string;
      amount: string;
      direction: 'credit' | 'debit';
      idempotencyKey: string;
      description?: string;
    }) => apiRequest('/admin/billing/adjust', { method: 'POST', body }),
    monitoring: () => apiRequest<Record<string, unknown>>('/admin/monitoring'),
    audit: (q: string) => apiRequest<Paginated<Record<string, unknown>>>(`/admin/audit?${q}`),
    tariffs: () => apiRequest<Paginated<Record<string, unknown>>>('/admin/tariffs?pageSize=100'),
  },

  cabinet: {
    dashboard: () => apiRequest<Record<string, unknown>>('/cabinet/dashboard'),
    estimate: (body: { checkType: 'HLR' | 'PING'; unitCount: number }) =>
      apiRequest<Record<string, unknown>>('/cabinet/billing/estimate', { method: 'POST', body }),
    submitCheck: (body: { checkType: 'HLR' | 'PING'; phones: string[] }) =>
      apiRequest('/cabinet/checks', { method: 'POST', body }),
    submitJob: (body: { checkType: 'HLR' | 'PING'; phones: string[] }) =>
      apiRequest('/cabinet/jobs', { method: 'POST', body }),
    jobs: (q: string) => apiRequest<Paginated<Record<string, unknown>>>(`/cabinet/jobs?${q}`),
    job: (id: string) => apiRequest<Record<string, unknown>>(`/cabinet/jobs/${id}`),
    jobItems: (id: string, q: string) =>
      apiRequest<Paginated<Record<string, unknown>>>(`/cabinet/jobs/${id}/items?${q}`),
    balance: () => apiRequest<Record<string, unknown>>('/cabinet/billing/balance'),
    ledger: () => apiRequest<unknown[]>('/cabinet/billing/ledger'),
    tariff: () => apiRequest<Record<string, unknown> | null>('/cabinet/billing/tariff'),
    apiKeys: (q: string) =>
      apiRequest<Paginated<Record<string, unknown>>>(`/cabinet/api-keys?${q}`),
    createApiKey: (body: { name: string }) =>
      apiRequest<Record<string, unknown>>('/cabinet/api-keys', { method: 'POST', body }),
    rotateApiKey: (id: string) =>
      apiRequest<Record<string, unknown>>(`/cabinet/api-keys/${id}/rotate`, { method: 'POST' }),
    revokeApiKey: (id: string) =>
      apiRequest<Record<string, unknown>>(`/cabinet/api-keys/${id}/revoke`, { method: 'POST' }),
    webhooks: (q: string) =>
      apiRequest<Paginated<Record<string, unknown>>>(`/cabinet/webhooks?${q}`),
    webhookSummary: () => apiRequest<Record<string, unknown>>('/cabinet/webhooks/summary'),
    deliveries: (q: string) =>
      apiRequest<Paginated<Record<string, unknown>>>(`/cabinet/webhooks/deliveries?${q}`),
    createWebhook: (body: Record<string, unknown>) =>
      apiRequest<Record<string, unknown>>('/cabinet/webhooks', { method: 'POST', body }),
    updateWebhook: (id: string, body: Record<string, unknown>) =>
      apiRequest<Record<string, unknown>>(`/cabinet/webhooks/${id}`, { method: 'PATCH', body }),
    rotateWebhook: (id: string) =>
      apiRequest<Record<string, unknown>>(`/cabinet/webhooks/${id}/rotate-secret`, {
        method: 'POST',
      }),
    deleteWebhook: (id: string) =>
      apiRequest<void>(`/cabinet/webhooks/${id}`, { method: 'DELETE' }),
  },
};
