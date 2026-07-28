ALTER TYPE "PracticeMode" ADD VALUE IF NOT EXISTS 'WORD_PRONUNCIATION';

ALTER TABLE "PracticeAttempt"
ADD COLUMN "dailyPlanId" TEXT,
ADD COLUMN "dailyTaskKey" TEXT;

ALTER TABLE "ReviewItemState"
ADD COLUMN "reviewStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "intervalDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "nextReviewAt" TIMESTAMP(3),
ADD COLUMN "lastReviewedAt" TIMESTAMP(3),
ADD COLUMN "lastResult" "LearningResult",
ADD COLUMN "lapseCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "successfulDays" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "DailyPlan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dateKey" TEXT NOT NULL,
  "tasks" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyPlan_userId_dateKey_key" ON "DailyPlan"("userId", "dateKey");
CREATE INDEX "DailyPlan_userId_completedAt_idx" ON "DailyPlan"("userId", "completedAt");
CREATE INDEX "PracticeAttempt_dailyPlanId_dailyTaskKey_occurredAt_idx"
ON "PracticeAttempt"("dailyPlanId", "dailyTaskKey", "occurredAt");
CREATE INDEX "ReviewItemState_userId_nextReviewAt_idx"
ON "ReviewItemState"("userId", "nextReviewAt");

ALTER TABLE "DailyPlan"
ADD CONSTRAINT "DailyPlan_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PracticeAttempt"
ADD CONSTRAINT "PracticeAttempt_dailyPlanId_fkey"
FOREIGN KEY ("dailyPlanId") REFERENCES "DailyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
