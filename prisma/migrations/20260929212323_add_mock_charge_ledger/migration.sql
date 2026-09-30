CREATE TYPE "MockChargeStatus" AS ENUM ('APPROVED', 'DECLINED');
CREATE TABLE "MockCharge" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "MockChargeStatus" NOT NULL,
    "reference" TEXT,
    "declineReason" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MockCharge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mockcharge_amount_positive" CHECK ("amountCents" > 0),
    CONSTRAINT "mockcharge_outcome_valid" CHECK (
      ("status" = 'APPROVED' AND "reference" IS NOT NULL AND "declineReason" IS NULL)
      OR ("status" = 'DECLINED' AND "reference" IS NULL AND "declineReason" IS NOT NULL)
    )
);
CREATE UNIQUE INDEX "MockCharge_description_key" ON "MockCharge"("description");
CREATE UNIQUE INDEX "MockCharge_reference_key" ON "MockCharge"("reference");
