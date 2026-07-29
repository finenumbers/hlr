# `@finenumbers/jobs`

Production-grade job orchestration for HLR / Ping-SMS (single, bulk, API).

Framework-agnostic: Nest API enqueues work; BullMQ workers process it. Provider HTTP stays behind `@finenumbers/provider-core` / `@finenumbers/provider-smsc`.

## Flow

```text
CreateJobService
  ├─ validate payload (type, source, phones)
  ├─ normalize + dedupe E.164
  ├─ estimate work units (= unique phones)
  ├─ persist Job + JobItems (QUEUED)
  └─ enqueue batches → jobs-submit
         │
         ▼
JobLifecycleService.processSubmitBatch
  ├─ mark Job PROCESSING
  ├─ claim item (QUEUED→RESERVED) — duplicate-safe
  ├─ billing.onItemReserved (noop until E07)
  ├─ provider.submitHlr|Ping
  ├─ item → PENDING (or terminal)
  ├─ on non-retryable failure → item FAILED (batch continues)
  └─ schedule jobs-status-poll
         │
         ├─ callback path → applyProviderUpdate (idempotent)
         └─ poll path → fetchStatus → applyProviderUpdate
                │
                ▼
         jobs-finalize → recompute counters → COMPLETED |
                         COMPLETED_WITH_ERRORS | FAILED
                │
                ├─ billing.onJobFinalized (noop / E07)
                └─ webhooks.onJobFinalized (noop / E13)

jobs-reconciliation
  ├─ re-queue stale PENDING/SENT items
  └─ finalize jobs with zero pending items
```

HTTP handlers must not call the provider or do bulk work inline.

## Queues

| Queue | Job name | Role |
|-------|----------|------|
| `jobs-submit` | `submit-batch` | Fan-out provider submit for item id batches |
| `jobs-status-poll` | `poll-item` | Fallback status when callback is late/missing |
| `jobs-finalize` | `finalize-job` | Close Job when all items terminal |
| `jobs-reconciliation` | `reconcile-stale` | Safety net for missed polls / finalize |

Constants: `QUEUE_NAMES`, `QUEUE_JOB_NAMES`, `QUEUE_DEFAULT_JOB_OPTIONS`.

### Retry / dead-letter

- **Submit**: BullMQ exponential backoff (`attempts: 3`) for *retryable* provider errors. Item stays `RESERVED` and is reclaimed on retry. Non-retryable item failures mark that item `FAILED` without failing the rest of the batch.
- **Poll**: App-driven delayed re-enqueue with exponential backoff from `pollIntervalSec`. Soft cap `pollMaxAttempts` + hard `checkTimeoutSec`.
- **Finalize**: BullMQ retries on transient DB errors.
- **Dead-letter**: After submit attempts are exhausted, worker calls `markSubmitBatchDeadLetter` → remaining `QUEUED|RESERVED` items → `FAILED` (`QUEUE_DEAD_LETTER`) → finalize.

## Status lifecycle

### JobItem

`QUEUED → RESERVED → SENT → PENDING → COMPLETED | FAILED` (+ `CANCELLED`)

`SENT` may be skipped in persistence when the provider ack already means `PENDING`.

### Job

`QUEUED → PROCESSING → COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED`

Derived when pending items hit zero:

| Items | Job status |
|-------|------------|
| all success | `COMPLETED` |
| all failed | `FAILED` |
| mixed | `COMPLETED_WITH_ERRORS` |

### Progress

Computed from counters: `total`, `processed`, `success`, `failed`, `pending`.

## Types / sources

- Check types: `HLR`, `PING`
- Sources: `SINGLE`, `BULK`, `API`
- Single = Job with exactly one JobItem

## Idempotency & duplicate protection

- Job create: `(tenantId, idempotencyKey)` unique + read-before-write
- Item claim: conditional `QUEUED → RESERVED` (re-accept `RESERVED` for submit retry)
- Terminal updates: `applyProviderUpdate` no-ops when already `COMPLETED|FAILED`
- Finalize: conditional update only from `QUEUED|PROCESSING`

## Extension points

| Hook | When | Stage |
|------|------|-------|
| `JobsBillingHooks.onItemReserved` | after claim | E07 reserve |
| `JobsBillingHooks.onItemTerminal` | item terminal (`capture` \| `release`) | E07 |
| `JobsBillingHooks.onJobFinalized` | job terminal | E07 reconcile |
| `JobsWebhookHooks.onItemTerminal` | item terminal | E13 |
| `JobsWebhookHooks.onJobFinalized` | job terminal | E13 |

Defaults: `createNoopBillingHooks` / `createNoopWebhookHooks`.

## Assumptions

1. Unit of work is `JobItem` (no separate Check model).
2. Callback HTTP endpoint (signature verify) is E09; this package exposes `applyProviderUpdate` for it.
3. Billing ledger and client webhook delivery are out of scope here.
4. Provider credentials / HTTP live only in the SMSC adapter.
5. Runtime limits come from `PlatformSettings` (+ tenant `maxBatchPhones` override).
6. Default country for national-format phones is `RU` (E.164 with `+` always preferred).

## Tests

```bash
pnpm --filter @finenumbers/jobs test
```

Coverage: create + batch enqueue, progress update, retryable submit, finalize, duplicate terminal protection, dead-letter.
