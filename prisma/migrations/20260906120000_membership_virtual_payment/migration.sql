CREATE TABLE "MembershipPaymentOrder" (
    "id" TEXT NOT NULL,
    "outTradeNo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "amountFen" INTEGER NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "env" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "transactionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPaymentOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipPaymentOrder_outTradeNo_key" ON "MembershipPaymentOrder"("outTradeNo");
CREATE INDEX "MembershipPaymentOrder_userId_createdAt_idx" ON "MembershipPaymentOrder"("userId", "createdAt");
CREATE INDEX "MembershipPaymentOrder_status_createdAt_idx" ON "MembershipPaymentOrder"("status", "createdAt");

ALTER TABLE "MembershipPaymentOrder" ADD CONSTRAINT "MembershipPaymentOrder_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
