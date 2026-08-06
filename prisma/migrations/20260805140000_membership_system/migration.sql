ALTER TABLE "User" ADD COLUMN "membershipExpiresAt" TIMESTAMP(3);

CREATE TABLE "MembershipRedemptionCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL DEFAULT 7,
    "label" TEXT,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipRedemptionCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipRedemptionCode_codeHash_key" ON "MembershipRedemptionCode"("codeHash");
CREATE INDEX "MembershipRedemptionCode_redeemedByUserId_redeemedAt_idx" ON "MembershipRedemptionCode"("redeemedByUserId", "redeemedAt");
CREATE INDEX "MembershipRedemptionCode_expiresAt_idx" ON "MembershipRedemptionCode"("expiresAt");

ALTER TABLE "MembershipRedemptionCode" ADD CONSTRAINT "MembershipRedemptionCode_redeemedByUserId_fkey" FOREIGN KEY ("redeemedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
