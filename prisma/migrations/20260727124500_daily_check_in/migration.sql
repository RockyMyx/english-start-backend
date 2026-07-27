CREATE TABLE "DailyCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyCheckIn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyCheckIn_userId_dateKey_key"
ON "DailyCheckIn"("userId", "dateKey");

CREATE INDEX "DailyCheckIn_userId_createdAt_idx"
ON "DailyCheckIn"("userId", "createdAt");

ALTER TABLE "DailyCheckIn"
ADD CONSTRAINT "DailyCheckIn_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
