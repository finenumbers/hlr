# Acceptance matrix: dual product tariffs (HLR / Ping-SMS)

Four client states × surfaces. Automated coverage lives mainly in
`packages/billing/src/product-tariff-matrix.test.ts` plus API/jobs regression tests listed below.

## States

| State | HLR assignment | Ping assignment |
|-------|----------------|-----------------|
| **none** | — | — |
| **hlr-only** | active | — |
| **ping-only** | — | active |
| **both** | active | active |

## Matrix (expected behaviour)

| Surface | none | hlr-only | ping-only | both |
|---------|------|----------|-----------|------|
| **Admin UI assign** | can assign either | can assign Ping / unassign HLR | can assign HLR / unassign Ping | can unassign either |
| **Admin UI detail** | both `none` | HLR `active`, Ping `none` | inverse | both `active` |
| **Admin UI list summary** | both null | shows HLR code | shows Ping code | both codes |
| **Client UI submit** | both unavailable texts | HLR form; Ping blocked text | inverse | both forms |
| **Client UI billing** | both not assigned | HLR price; Ping not assigned | inverse | both prices |
| **Client UI history** | empty / filter either | filter HLR | filter Ping | filter or all |
| **Public API create** | both → `TARIFF_NOT_CONFIGURED` | HLR ok; Ping blocked | inverse | both ok |
| **Estimate** | both blocked | HLR ok; Ping blocked | inverse | both ok, distinct prices |
| **assertCanAfford** | both blocked | HLR ok; Ping blocked | inverse | both ok |
| **Reserve** | blocked (no live assignment) | HLR ok; Ping blocked | inverse | both ok |
| **Finalize (capture)** | n/a / 0 without HOLD | HLR capture | Ping capture | both |
| **History `checkType`** | n/a | column/filter HLR | column/filter Ping | separable |

## Automated tests

### Covered now

| Area | File | What |
|------|------|------|
| Core 4-state matrix | `packages/billing/src/product-tariff-matrix.test.ts` | quote/inspect/estimate/afford/reserve/finalize + no cross-fallback + invalid plan |
| Dual prices (legacy) | `packages/billing/src/billing.service.test.ts` | both → ping-only transition |
| Admin assign | `apps/api/src/modules/tariffs/tariffs.assign.test.ts` | dual assign, cross-type reject, unassign |
| Cabinet getTariff | `apps/api/src/modules/cabinet/cabinet-tariff-availability.test.ts` | 4-state sell-only slots |
| Public type map | `apps/api/src/modules/public-api/check-type-mapping.test.ts` | `hlr`/`ping` → `HLR`/`PING` |
| History filter | `apps/api/src/modules/jobs/jobs.check-type-filter.test.ts` | Prisma `checkType` where |
| Lifecycle PING | `packages/jobs/src/lifecycle.service.test.ts` | submitPing path + tariff fail |
| Client DTO redact | `apps/api/src/modules/cabinet/cabinet-client-view.test.ts` | no providerCost |

### E2E / UI runners (added)

| Gap | Status |
|-----|--------|
| Web UI (Vitest + RTL) | `apps/web` — `product-submit-page.test.tsx` (4 states) |
| Nest HTTP create → SMSC | `apps/api/src/test/e2e/create-to-smsc.e2e.test.ts` |
| Worker create → SMSC → finalize | `apps/worker/src/create-to-smsc.e2e.test.ts` |
| Admin list inactive plan | Fixed + `tenant-tariff-summary.test.ts` |

## Fixed during matrix pass

**Admin tenant list** no longer shows inactive plans as assigned (`mapTenantTariffsSummary` requires `tariffPlan.isActive`). Detail still uses full `inspectProductTariffs` for effective-window invalid.
