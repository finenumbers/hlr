import { describe, expect, it } from 'vitest';

import {
  canTransitionJobItem,
  computeProgress,
  deriveJobTerminalStatus,
  mapProviderLifecycleToItemStatus,
} from './state-machine.js';

describe('job item transitions', () => {
  it('allows forward lifecycle', () => {
    expect(canTransitionJobItem('QUEUED', 'RESERVED')).toBe(true);
    expect(canTransitionJobItem('RESERVED', 'SENT')).toBe(true);
    expect(canTransitionJobItem('SENT', 'PENDING')).toBe(true);
    expect(canTransitionJobItem('PENDING', 'COMPLETED')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(canTransitionJobItem('COMPLETED', 'PENDING')).toBe(false);
    expect(canTransitionJobItem('QUEUED', 'PENDING')).toBe(false);
  });
});

describe('mapProviderLifecycleToItemStatus', () => {
  it('maps completed/failed', () => {
    expect(mapProviderLifecycleToItemStatus('completed', 'PENDING')).toBe('COMPLETED');
    expect(mapProviderLifecycleToItemStatus('failed', 'PENDING')).toBe('FAILED');
  });

  it('maps accepted to pending from sent', () => {
    expect(mapProviderLifecycleToItemStatus('accepted', 'SENT')).toBe('PENDING');
  });
});

describe('deriveJobTerminalStatus', () => {
  it('derives completed / failed / with errors', () => {
    expect(deriveJobTerminalStatus({ total: 2, success: 2, failed: 0 })).toBe('COMPLETED');
    expect(deriveJobTerminalStatus({ total: 2, success: 0, failed: 2 })).toBe('FAILED');
    expect(deriveJobTerminalStatus({ total: 2, success: 1, failed: 1 })).toBe(
      'COMPLETED_WITH_ERRORS',
    );
  });
});

describe('computeProgress', () => {
  it('tracks total/processed/pending', () => {
    expect(
      computeProgress({ itemCount: 10, successCount: 3, failureCount: 2 }),
    ).toEqual({
      total: 10,
      processed: 5,
      success: 3,
      failed: 2,
      pending: 5,
    });
  });
});
