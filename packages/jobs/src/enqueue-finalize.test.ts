import { describe, expect, it, vi } from 'vitest';

import {
  enqueueFinalizeJobOnQueue,
  finalizeBullJobId,
  type FinalizeQueueLike,
} from './enqueue-finalize.js';
import { QUEUE_JOB_NAMES } from './queue-names.js';

describe('enqueueFinalizeJobOnQueue', () => {
  const payload = {
    jobId: 'job-1',
    tenantId: 'tenant-1',
    reason: 'item-terminal',
  };

  it('adds finalize job when none exists', async () => {
    const add = vi.fn().mockResolvedValue({});
    const queue: FinalizeQueueLike = {
      getJob: vi.fn().mockResolvedValue(null),
      add,
    };

    await enqueueFinalizeJobOnQueue(queue, payload);

    expect(add).toHaveBeenCalledWith(QUEUE_JOB_NAMES.FINALIZE_JOB, payload, {
      jobId: finalizeBullJobId('job-1'),
    });
  });

  it('no-ops when finalize is already active', async () => {
    const add = vi.fn();
    const remove = vi.fn();
    const queue: FinalizeQueueLike = {
      getJob: vi.fn().mockResolvedValue({
        getState: async () => 'active',
        remove,
      }),
      add,
    };

    await enqueueFinalizeJobOnQueue(queue, payload);

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('removes waiting finalize and re-enqueues', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({});
    const queue: FinalizeQueueLike = {
      getJob: vi.fn().mockResolvedValue({
        getState: async () => 'waiting',
        remove,
      }),
      add,
    };

    await enqueueFinalizeJobOnQueue(queue, payload);

    expect(remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(QUEUE_JOB_NAMES.FINALIZE_JOB, payload, {
      jobId: finalizeBullJobId('job-1'),
    });
  });

  it('removes a completed no-op finalize and re-enqueues', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({});
    const queue: FinalizeQueueLike = {
      getJob: vi.fn().mockResolvedValue({
        getState: async () => 'completed',
        remove,
      }),
      add,
    };

    await enqueueFinalizeJobOnQueue(queue, payload);

    expect(remove).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(QUEUE_JOB_NAMES.FINALIZE_JOB, payload, {
      jobId: finalizeBullJobId('job-1'),
    });
  });

  it('ignores BullMQ duplicate jobId races', async () => {
    const queue: FinalizeQueueLike = {
      getJob: vi.fn().mockResolvedValue(null),
      add: vi.fn().mockRejectedValue(new Error('Job finalize:job-1 already exists')),
    };

    await expect(enqueueFinalizeJobOnQueue(queue, payload)).resolves.toBeUndefined();
  });
});
