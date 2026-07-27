import type {
  AttemptInput,
  ChoiceQuestion,
  DashboardRecord,
  DialoguePromptRecord,
  IdentityContext,
  PracticeAnswerInput,
  PracticeAnswerResult,
  SentencePromptRecord,
  SessionRecord,
  StarterWordRecord,
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
  updateDailyScoreGoal(context: IdentityContext, dailyScoreGoal: number): Promise<number>;

  listStarterWords(): Promise<StarterWordRecord[]>;
  importStarterPack(context: IdentityContext): Promise<{ imported: number; total: number }>;
  listWords(context: IdentityContext): Promise<WordRecord[]>;
  addWord(context: IdentityContext, input: WordInput): Promise<WordRecord>;
  updateWord(context: IdentityContext, wordId: string, input: WordInput): Promise<WordRecord | null>;
  archiveWord(context: IdentityContext, wordId: string): Promise<boolean>;
  archiveAllWords(context: IdentityContext): Promise<number>;

  getChoiceQuestions(
    context: IdentityContext,
    mode: ChoiceQuestion["mode"],
    limit: number
  ): Promise<ChoiceQuestion[]>;
  answerPractice(
    context: IdentityContext,
    input: PracticeAnswerInput
  ): Promise<PracticeAnswerResult>;

  listSentencePrompts(context: IdentityContext): Promise<SentencePromptRecord[]>;
  getSentencePrompt(context: IdentityContext, id: string): Promise<SentencePromptRecord | null>;
  listDialoguePrompts(context: IdentityContext): Promise<DialoguePromptRecord[]>;
  getDialoguePrompt(context: IdentityContext, id: string): Promise<DialoguePromptRecord | null>;
  recordAttempt(context: IdentityContext, input: AttemptInput): Promise<void>;
}
