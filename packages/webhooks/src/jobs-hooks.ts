import type { JobsWebhookHooks, JobsLogger } from '@finenumbers/jobs';
import type { PrismaClient } from '@finenumbers/db';

import { eventForItemStatus, WEBHOOK_EVENTS } from './events.js';
import type { WebhookDeliveryService } from './delivery.service.js';
import type { CheckWebhookData, JobWebhookData } from './payload.js';

/** Strip supplier brand from client webhook payloads (EN). */
function scrubErrorMessage(text: string | null): string | null {
  if (text == null || text === '') return text;
  return text.replace(/\bSMSC(?:\.ru)?\b/gi, 'provider');
}

/**
 * Bridge job lifecycle terminal events → webhook fan-out (async enqueue only).
 */
export function createJobsWebhookHooks(
  service: WebhookDeliveryService,
  prisma: PrismaClient,
  logger?: JobsLogger,
): JobsWebhookHooks {
  return {
    async onItemTerminal(input) {
      const item = await prisma.jobItem.findUnique({
        where: { id: input.jobItemId },
        select: {
          id: true,
          jobId: true,
          checkType: true,
          status: true,
          phoneE164: true,
          resultStatus: true,
          isReachable: true,
          imsi: true,
          mcc: true,
          mnc: true,
          operatorName: true,
          countryCode: true,
          ported: true,
          roaming: true,
          errorCode: true,
          errorMessage: true,
          completedAt: true,
        },
      });
      if (!item) {
        logger?.warn('webhooks.hook.item_missing', { jobItemId: input.jobItemId });
        return;
      }

      const data: CheckWebhookData = {
        jobId: item.jobId,
        jobItemId: item.id,
        checkType: item.checkType,
        status: item.status,
        phoneE164: item.phoneE164,
        resultStatus: item.resultStatus,
        isReachable: item.isReachable,
        imsi: item.imsi,
        mcc: item.mcc,
        mnc: item.mnc,
        operatorName: item.operatorName,
        countryCode: item.countryCode,
        ported: item.ported,
        roaming: item.roaming,
        errorCode: item.errorCode,
        errorMessage: scrubErrorMessage(item.errorMessage),
        completedAt: item.completedAt?.toISOString() ?? null,
      };

      const eventType = eventForItemStatus(input.status);
      await service.enqueueForEvent({
        tenantId: input.tenantId,
        eventType,
        jobItemId: item.id,
        data,
      });
    },

    async onJobFinalized(input) {
      // job.completed covers COMPLETED and COMPLETED_WITH_ERRORS (terminal success paths).
      if (
        input.status !== 'COMPLETED' &&
        input.status !== 'COMPLETED_WITH_ERRORS' &&
        input.status !== 'FAILED'
      ) {
        return;
      }

      const job = await prisma.job.findUnique({
        where: { id: input.jobId },
        select: {
          id: true,
          checkType: true,
          status: true,
          itemCount: true,
          successCount: true,
          failureCount: true,
          completedAt: true,
        },
      });
      if (!job) {
        logger?.warn('webhooks.hook.job_missing', { jobId: input.jobId });
        return;
      }

      const data: JobWebhookData = {
        jobId: job.id,
        checkType: job.checkType,
        status: job.status,
        itemCount: job.itemCount,
        successCount: job.successCount,
        failureCount: job.failureCount,
        completedAt: job.completedAt?.toISOString() ?? null,
      };

      await service.enqueueForEvent({
        tenantId: input.tenantId,
        eventType: WEBHOOK_EVENTS.JOB_COMPLETED,
        data,
      });
    },
  };
}
