ALTER TABLE "User"
ADD COLUMN "englishName" TEXT,
ADD COLUMN "avatarFileName" TEXT;

ALTER TABLE "PracticeAttempt"
ADD COLUMN "exerciseKey" TEXT,
ADD COLUMN "promptText" TEXT,
ADD COLUMN "referenceAnswer" TEXT;

CREATE INDEX "PracticeAttempt_userId_exerciseKey_occurredAt_idx"
ON "PracticeAttempt"("userId", "exerciseKey", "occurredAt");

CREATE TABLE "ReviewItemState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemType" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "masteredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewItemState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewItemState_userId_itemType_itemKey_key"
ON "ReviewItemState"("userId", "itemType", "itemKey");

CREATE INDEX "ReviewItemState_userId_masteredAt_idx"
ON "ReviewItemState"("userId", "masteredAt");

ALTER TABLE "ReviewItemState"
ADD CONSTRAINT "ReviewItemState_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
