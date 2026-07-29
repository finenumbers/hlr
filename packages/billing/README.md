# `@finenumbers/billing`

Ledger-first money engine for multi-tenant HLR / Ping-SMS billing.

## Flow

```
estimate(tariff) → HOLD (reserve) → provider work
                                      ├─ provider final status → DEBIT (capture)
                                      │     └─ if charge < hold → RELEASE remainder
                                      └─ send-fail / timeout     → RELEASE (full hold)
```

Policy B (product default): on provider final status (including provider `err` / unreachable) we **capture** the reserved **sell price**. Release is only for send failure / timeout before a final provider status.

1. **Estimate** — `TariffResolver` picks tenant assignment for the requested `checkType` (optional sell override); returns sell price + internal provider cost separately. No silent default-plan fallback.
2. **Reserve** — before provider submit (`JobsBillingHooks.onItemReserved`): `HOLD` for sell price, `available → held`, stamp `JobItem.estimatedCost`.
3. **Capture** — on terminal provider result: `DEBIT` linked via `relatedHoldId`; optional partial capture releases unused hold.
4. **Release** — on submit/timeout failure: full `RELEASE` of open hold.
5. **Top-up / adjustment** — admin `CREDIT` / `ADJUSTMENT` with audit + idempotency keys.

## Invariants

| Invariant | Enforcement |
|-----------|-------------|
| Ledger is source of truth | Balances reconstructible via `foldLedgerBalances(wallet_transactions)`; wallet columns are cache |
| No float money | `Decimal(18,6)` / `Prisma.Decimal` only |
| Amounts non-negative | Direction implied by `type` (+ `metadata.direction` for `ADJUSTMENT`) |
| No double charge | Deterministic keys + unique `(tenantId, idempotencyKey)` + in-TX re-check + P2002 recovery |
| No negative wallet (default) | HOLD / available debit rejected when funds insufficient |
| Sell ≠ provider cost | Client charged `sellPrice`; `providerCost` only in metadata / estimates |
| Job linkage | `jobItemId` FK on HOLD/DEBIT/RELEASE; `metadata.jobId` + phone; `relatedHoldId` chains settlements |
| Row safety | `SELECT … FOR UPDATE` on wallet inside interactive transaction |

## Money handling rules

- **Storage**: PostgreSQL `NUMERIC` / Prisma `Decimal(18,6)` — never `Float`/`Double`.
- **Runtime**: only `string` (decimal text) or `Prisma.Decimal`. JS `number` is rejected for amounts (IEEE-754 float).
- **Quantities** (e.g. phone count): `moneyFromSafeInteger` — integers only, then Decimal multiply.
- **CREDIT** — manual top-up → `available += amount`
- **HOLD** — reserve → `available -= amount`, `held += amount`
- **DEBIT** — capture from hold → `held -= amount` (funds leave the system)
- **RELEASE** — unreserve → `held -= amount`, `available += amount`
- **ADJUSTMENT** — admin correction; `metadata.direction` = `credit` \| `debit` against **available** only

Idempotency key conventions:

- `hold:jobItem:{id}`
- `debit:jobItem:{id}`
- `release:jobItem:{id}`
- `release-remainder:jobItem:{id}`
- `topup:{tenantId}:{callerKey}`
- `adjustment:{tenantId}:{callerKey}`

## Tariff resolution

1. Active `TenantTariff` for `(tenantId, checkType)` pointing at a `TariffPlan` of the same `checkType`
2. Optional `priceOverride` on the assignment replaces plan `sellPrice`
3. Else `TARIFF_NOT_CONFIGURED` (cannot estimate / start / reserve that product)

`TariffPlan.isDefault` is catalog metadata only and is **not** auto-applied in billing. Provider cost (`providerCost`) is never mixed into client charge fields (`JobItem.estimatedCost` / `actualCost` are sell-side).

## Jobs integration

```ts
import { BillingService, createBillingJobsHooks } from '@finenumbers/billing';

const billing = new BillingService({ prisma, audit });
const hooks = createBillingJobsHooks(billing, logger);

new JobLifecycleService({ store, queue, provider, billing: hooks });
```

## Assumptions

- One open HOLD per `jobItemId` (MVP).
- Capture amount defaults to full hold (Policy B); callers may pass a lower `chargeAmount` for partial return.
- Mid-flight crash after HOLD but before capture/release leaves funds in `held` until terminal hook / ops reconciliation — never silently drops the HOLD.
- Wallet cache (`availableBalance` / `heldBalance`) is updated only alongside ledger rows.
- **Explainability**: `getBalancesFromLedger` / `reconcileWallet` fold all rows; if cache drifts, `reconcileWallet({ repair: true })` rewrites cache from the ledger.
- Negative balance is forbidden unless `adjust({ allowNegative: true })` is explicit.
- Payment gateway / self-serve checkout is out of scope (manual top-up only).

## Tests

```bash
pnpm --filter @finenumbers/billing test
```

Covers: reserve/capture/release, **retry/idempotency (no double charge)**, top-up, tariff override, jobs hooks, ledger fold vs cache, cache repair from ledger.
