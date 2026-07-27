-- Create the new single-user learning model while the legacy tables still exist.
CREATE TYPE "VocabularySource" AS ENUM ('STARTER', 'USER', 'LEGACY');
CREATE TYPE "PracticeMode" AS ENUM (
  'WORD_READING',
  'LISTEN_CHOOSE_MEANING',
  'MEANING_CHOOSE_WORD',
  'WORD_CHOOSE_MEANING',
  'DICTATION',
  'SENTENCE',
  'DIALOGUE_TEXT',
  'DIALOGUE_VOICE'
);

ALTER TABLE "WordProgress" RENAME TO "LegacyWordProgress";
ALTER TABLE "LegacyWordProgress"
  RENAME CONSTRAINT "WordProgress_pkey" TO "LegacyWordProgress_pkey";
ALTER TABLE "Session" DROP COLUMN "parentVerifiedUntil";

CREATE TABLE "StarterVocabulary" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "english" TEXT NOT NULL,
  "normalizedEnglish" TEXT NOT NULL,
  "chinese" TEXT NOT NULL,
  "phonetic" TEXT,
  "sortOrder" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StarterVocabulary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VocabularyItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "english" TEXT NOT NULL,
  "normalizedEnglish" TEXT NOT NULL,
  "chinese" TEXT NOT NULL,
  "phonetic" TEXT,
  "source" "VocabularySource" NOT NULL,
  "sourceKey" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VocabularyItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SentencePrompt" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "targetWord" TEXT NOT NULL,
  "promptChinese" TEXT NOT NULL,
  "referenceAnswer" TEXT NOT NULL,
  "acceptedAnswers" TEXT[] NOT NULL,
  "explanation" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SentencePrompt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DialoguePrompt" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "questionChinese" TEXT NOT NULL,
  "referenceAnswer" TEXT NOT NULL,
  "acceptedAnswers" TEXT[] NOT NULL,
  "evaluationHint" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DialoguePrompt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PracticeAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "vocabularyItemId" TEXT,
  "mode" "PracticeMode" NOT NULL,
  "result" "LearningResult" NOT NULL,
  "answerText" TEXT,
  "recognizedText" TEXT,
  "feedback" TEXT,
  "semanticScore" DOUBLE PRECISION,
  "pronunciationScore" DOUBLE PRECISION,
  "accuracyScore" DOUBLE PRECISION,
  "fluencyScore" DOUBLE PRECISION,
  "completenessScore" DOUBLE PRECISION,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PracticeAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WordProgress" (
  "userId" TEXT NOT NULL,
  "vocabularyItemId" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "correctCount" INTEGER NOT NULL DEFAULT 0,
  "incorrectCount" INTEGER NOT NULL DEFAULT 0,
  "lastPracticedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WordProgress_pkey" PRIMARY KEY ("userId", "vocabularyItemId")
);

CREATE UNIQUE INDEX "StarterVocabulary_key_key" ON "StarterVocabulary"("key");
CREATE INDEX "StarterVocabulary_category_sortOrder_idx" ON "StarterVocabulary"("category", "sortOrder");
CREATE UNIQUE INDEX "VocabularyItem_userId_normalizedEnglish_key" ON "VocabularyItem"("userId", "normalizedEnglish");
CREATE UNIQUE INDEX "VocabularyItem_userId_sourceKey_key" ON "VocabularyItem"("userId", "sourceKey");
CREATE INDEX "VocabularyItem_userId_archivedAt_idx" ON "VocabularyItem"("userId", "archivedAt");
CREATE UNIQUE INDEX "SentencePrompt_key_key" ON "SentencePrompt"("key");
CREATE UNIQUE INDEX "DialoguePrompt_key_key" ON "DialoguePrompt"("key");
CREATE INDEX "PracticeAttempt_userId_occurredAt_idx" ON "PracticeAttempt"("userId", "occurredAt");
CREATE INDEX "PracticeAttempt_vocabularyItemId_idx" ON "PracticeAttempt"("vocabularyItemId");
CREATE INDEX "PracticeAttempt_mode_occurredAt_idx" ON "PracticeAttempt"("mode", "occurredAt");
CREATE UNIQUE INDEX "WordProgress_vocabularyItemId_key" ON "WordProgress"("vocabularyItemId");

ALTER TABLE "VocabularyItem"
  ADD CONSTRAINT "VocabularyItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeAttempt"
  ADD CONSTRAINT "PracticeAttempt_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PracticeAttempt"
  ADD CONSTRAINT "PracticeAttempt_vocabularyItemId_fkey"
  FOREIGN KEY ("vocabularyItemId") REFERENCES "VocabularyItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WordProgress"
  ADD CONSTRAINT "WordProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WordProgress"
  ADD CONSTRAINT "WordProgress_vocabularyItemId_fkey"
  FOREIGN KEY ("vocabularyItemId") REFERENCES "VocabularyItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve each user's active legacy wordbook. A duplicate English spelling is collapsed per user.
WITH legacy_items AS (
  SELECT DISTINCT ON (fm."userId", w."normalizedText")
    fm."userId",
    w."id" AS "legacyWordId",
    w."text",
    w."normalizedText",
    w."meaning",
    w."phonetic",
    w."visibility",
    wi."createdAt"
  FROM "FamilyMember" fm
  JOIN "ChildProfile" cp ON cp."familyId" = fm."familyId" AND cp."active" = true
  JOIN "Wordbook" wb ON wb."childId" = cp."id"
  JOIN "WordbookItem" wi ON wi."wordbookId" = wb."id"
  JOIN "Word" w ON w."id" = wi."wordId"
  ORDER BY fm."userId", w."normalizedText", wi."createdAt"
)
INSERT INTO "VocabularyItem" (
  "id", "userId", "english", "normalizedEnglish", "chinese", "phonetic",
  "source", "sourceKey", "createdAt", "updatedAt"
)
SELECT
  'legacy-word-' || md5("userId" || ':' || "legacyWordId"),
  "userId",
  "text",
  "normalizedText",
  "meaning",
  "phonetic",
  CASE WHEN "visibility" = 'SYSTEM' THEN 'LEGACY'::"VocabularySource" ELSE 'USER'::"VocabularySource" END,
  NULL,
  "createdAt",
  CURRENT_TIMESTAMP
FROM legacy_items;

-- Preserve legacy reading history and progress under the owning user.
WITH child_owners AS (
  SELECT DISTINCT ON (cp."id")
    cp."id" AS "childId",
    fm."userId"
  FROM "ChildProfile" cp
  JOIN "FamilyMember" fm ON fm."familyId" = cp."familyId"
  ORDER BY cp."id", fm."createdAt"
)
INSERT INTO "PracticeAttempt" (
  "id", "userId", "vocabularyItemId", "mode", "result", "occurredAt"
)
SELECT
  'legacy-attempt-' || le."id",
  co."userId",
  vi."id",
  'WORD_READING'::"PracticeMode",
  le."result",
  le."occurredAt"
FROM "LearningEvent" le
JOIN child_owners co ON co."childId" = le."childId"
JOIN "Word" w ON w."id" = le."wordId"
LEFT JOIN "VocabularyItem" vi
  ON vi."userId" = co."userId" AND vi."normalizedEnglish" = w."normalizedText";

WITH child_owners AS (
  SELECT DISTINCT ON (cp."id")
    cp."id" AS "childId",
    fm."userId"
  FROM "ChildProfile" cp
  JOIN "FamilyMember" fm ON fm."familyId" = cp."familyId"
  ORDER BY cp."id", fm."createdAt"
)
INSERT INTO "WordProgress" (
  "userId", "vocabularyItemId", "attemptCount", "correctCount",
  "incorrectCount", "lastPracticedAt", "updatedAt"
)
SELECT
  co."userId",
  vi."id",
  lwp."readCount",
  0,
  0,
  lwp."lastReadAt",
  CURRENT_TIMESTAMP
FROM "LegacyWordProgress" lwp
JOIN child_owners co ON co."childId" = lwp."childId"
JOIN "Word" w ON w."id" = lwp."wordId"
JOIN "VocabularyItem" vi
  ON vi."userId" = co."userId" AND vi."normalizedEnglish" = w."normalizedText"
ON CONFLICT ("userId", "vocabularyItemId") DO UPDATE SET
  "attemptCount" = EXCLUDED."attemptCount",
  "lastPracticedAt" = EXCLUDED."lastPracticedAt",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Remove the family/child implementation after all active learning data is copied.
DROP TABLE "LegacyWordProgress";
DROP TABLE "LearningEvent";
DROP TABLE "GuardianCredential";
DROP TABLE "WordbookItem";
DROP TABLE "Wordbook";
DROP TABLE "ChildProfile";
DROP TABLE "FamilyMember";
DROP TABLE "Word";
DROP TABLE "Family";
DROP TYPE "LearningActivity";
DROP TYPE "WordVisibility";
DROP TYPE "FamilyRole";
