ALTER TABLE "User"
ADD COLUMN "learnerAgeBand" TEXT,
ADD COLUMN "gradeLevel" TEXT,
ADD COLUMN "englishExperience" TEXT,
ADD COLUMN "learningGoals" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "InitialAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "level" TEXT,
    "scores" JSONB,
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InitialAssessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InitialAssessmentAnswer" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "answerText" TEXT,
    "recognizedText" TEXT,
    "score" DOUBLE PRECISION,
    "pronunciationScore" DOUBLE PRECISION,
    "accuracyScore" DOUBLE PRECISION,
    "fluencyScore" DOUBLE PRECISION,
    "completenessScore" DOUBLE PRECISION,
    "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InitialAssessmentAnswer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InitialAssessment_userId_status_startedAt_idx"
ON "InitialAssessment"("userId", "status", "startedAt");

CREATE UNIQUE INDEX "InitialAssessmentAnswer_assessmentId_questionKey_key"
ON "InitialAssessmentAnswer"("assessmentId", "questionKey");

CREATE INDEX "InitialAssessmentAnswer_assessmentId_dimension_idx"
ON "InitialAssessmentAnswer"("assessmentId", "dimension");

ALTER TABLE "InitialAssessment"
ADD CONSTRAINT "InitialAssessment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InitialAssessmentAnswer"
ADD CONSTRAINT "InitialAssessmentAnswer_assessmentId_fkey"
FOREIGN KEY ("assessmentId") REFERENCES "InitialAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
