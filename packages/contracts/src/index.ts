/** Shared API / domain contracts (scaffold). Domain types land in later stages. */

export type HealthStatus = 'ok' | 'degraded' | 'down';

export type HealthLiveResponse = {
  status: 'ok';
  service: string;
  timestamp: string;
};

export type HealthReadyCheck = {
  name: string;
  status: HealthStatus;
  detail?: string;
};

export type HealthReadyResponse = {
  status: HealthStatus;
  service: string;
  timestamp: string;
  checks: HealthReadyCheck[];
};
