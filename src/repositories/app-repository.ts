import type {
  AttemptInput,
  CheckInSummary,
  ChoiceQuestion,
  DailyPlanRecord,
  DailyPlanTaskKey,
  DashboardRecord,
  DialoguePromptRecord,
  IdentityContext,
  LearningReport,
  ReviewItemStatus,
  ReviewItemType,
  ReviewOverview,
  PracticeAnswerInput,
  PracticeAnswerResult,
  SentencePromptRecord,
  SessionRecord,
  StarterWordRecord,
  UserProfile,
  WordInput,
  WordRecord
} from "../domain/types.js";

export interface AppRepository {
  ensureIdentity(openId: string): Promise<IdentityContext>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  getContext(userId: string): Promise<IdentityContext>;
  getDashboard(context: IdentityContext): Promise<DashboardRecord>;
  getProfile(context: IdentityContext): Promise<UserProfile>;
  updateProfile(
    context: IdentityContext,
    input: { nickname?: string; englishName?: string }
  ): Promise<UserProfile>;
  updateAvatar(context: IdentityContext, avatarFileName: string): Promise<UserProfile>;
  updateDailyScoreGoal(context: IdentityContext, dailyScoreGoal: number): Promise<number>;
  checkInToday(context: IdentityContext): Promise<CheckInSummary>;
  getTodayDailyPlan(context: IdentityContext): Promise<DailyPlanRecord>;
  getDailyPlanTaskWords(
    context: IdentityContext,
    planId: string,
    taskKey: DailyPlanTaskKey
  ): Promise<WordRecord[]>;
  getLearningReport(context: IdentityContext): Promise<LearningReport>;
  getReviewOverview(context: IdentityContext): Promise<ReviewOverview>;
  setReviewStatus(
    context: IdentityContext,
    itemType: ReviewItemType,
    itemKey: string,
    status: ReviewItemStatus
  ): Promise<void>;

  listStarterWords(): Promise<StarterWordRecord[]>;
  importStarterPack(context: IdentityContext): Promise<{ imported: number; total: number }>;
  listWords(context: IdentityContext): Promise<WordRecord[]>;
  getWord(context: IdentityContext, wordId: string): Promise<WordRecord | null>;
  addWord(context: IdentityContext, input: WordInput): Promise<WordRecord>;
  addWords(context: IdentityContext, inputs: WordInput[]): Promise<WordRecord[]>;
  updateWord(context: IdentityContext, wordId: string, input: WordInput): Promise<WordRecord | null>;
  archiveWord(context: IdentityContext, wordId: string): Promise<boolean>;
  archiveAllWords(context: IdentityContext): Promise<number>;

  getChoiceQuestions(
    context: IdentityContext,
    mode: ChoiceQuestion["mode"],
    limit: number,
    scope?: "all" | "weak",
    targetWordIds?: string[]
  ): Promise<ChoiceQuestion[]>;
  answerPractice(
    context: IdentityContext,
    input: PracticeAnswerInput
  ): Promise<PracticeAnswerResult>;

  listSentencePrompts(
    context: IdentityContext,
    scope?: "all" | "weak"
  ): Promise<SentencePromptRecord[]>;
  getSentencePrompt(context: IdentityContext, id: string): Promise<SentencePromptRecord | null>;
  listDialoguePrompts(
    context: IdentityContext,
    scope?: "all" | "weak"
  ): Promise<DialoguePromptRecord[]>;
  getDialoguePrompt(context: IdentityContext, id: string): Promise<DialoguePromptRecord | null>;
  recordAttempt(context: IdentityContext, input: AttemptInput): Promise<void>;
}
