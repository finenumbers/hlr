import type { RateLimitZone } from './rate-limit-zone';

export type ZoneRpmConfig = {
  /** Canonical submit RPM (key → tenant → platform). */
  submitRpm: number;
  /** read = submit * multiplier, capped by readRpmMax. */
  readMultiplier: number;
  readRpmMax: number;
  /** Absolute webhook-zone RPM (also capped by submitRpm * webhookMultiplier). */
  webhookRpm: number;
  webhookMultiplier: number;
};

/**
 * Resolve per-zone RPM. Buckets are independent so polling does not starve submit quota
 * and webhook CRUD cannot burn the submit budget.
 */
export function resolveZoneRpm(
  zone: Exclude<RateLimitZone, 'auth'>,
  config: ZoneRpmConfig,
): number {
  const submit = Math.max(1, config.submitRpm);

  if (zone === 'submit') {
    return submit;
  }

  if (zone === 'read') {
    const scaled = Math.ceil(submit * Math.max(1, config.readMultiplier));
    return Math.max(1, Math.min(scaled, Math.max(1, config.readRpmMax)));
  }

  // webhook: tighter than submit; absolute ceiling + fraction of submit
  const fromSubmit = Math.ceil(submit * Math.max(0.1, config.webhookMultiplier));
  return Math.max(1, Math.min(config.webhookRpm, fromSubmit, submit));
}
