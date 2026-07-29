import { describe, expect, it } from 'vitest';

import { resolveZoneRpm } from './resolve-zone-rpm';

describe('resolveZoneRpm', () => {
  const base = {
    submitRpm: 60,
    readMultiplier: 5,
    readRpmMax: 600,
    webhookRpm: 60,
    webhookMultiplier: 1,
  };

  it('uses submit RPM for submit zone', () => {
    expect(resolveZoneRpm('submit', base)).toBe(60);
  });

  it('scales read above submit and respects max', () => {
    expect(resolveZoneRpm('read', base)).toBe(300);
    expect(
      resolveZoneRpm('read', { ...base, submitRpm: 200, readRpmMax: 600 }),
    ).toBe(600);
  });

  it('keeps webhook tighter than submit', () => {
    expect(resolveZoneRpm('webhook', base)).toBe(60);
    expect(
      resolveZoneRpm('webhook', {
        ...base,
        submitRpm: 200,
        webhookRpm: 40,
        webhookMultiplier: 1,
      }),
    ).toBe(40);
    expect(
      resolveZoneRpm('webhook', {
        ...base,
        submitRpm: 10,
        webhookRpm: 60,
        webhookMultiplier: 0.5,
      }),
    ).toBe(5);
  });
});
