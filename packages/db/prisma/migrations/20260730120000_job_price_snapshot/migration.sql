-- Freeze sell/provider unit prices at job accept for stable billing through processing.

ALTER TABLE "jobs"
  ADD COLUMN "unitSellPrice" DECIMAL(18,6),
  ADD COLUMN "unitProviderCost" DECIMAL(18,6),
  ADD COLUMN "tariffPlanId" TEXT,
  ADD COLUMN "tariffPlanCode" TEXT;

ALTER TABLE "job_items"
  ADD COLUMN "unitSellPrice" DECIMAL(18,6),
  ADD COLUMN "unitProviderCost" DECIMAL(18,6),
  ADD COLUMN "tariffPlanId" TEXT,
  ADD COLUMN "tariffPlanCode" TEXT;
