export type PracticeMode =
  | "WORD_READING"
  | "LISTEN_CHOOSE_MEANING"
  | "MEANING_CHOOSE_WORD"
  | "WORD_CHOOSE_MEANING"
  | "DICTATION"
  | "SENTENCE"
  | "DIALOGUE_TEXT"
  | "DIALOGUE_VOICE";

export type LearningResult = "VIEWED" | "CORRECT" | "INCORRECT";

export interface IdentityContext {
  userId: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface ModuleAvailability {
  reading: boolean;
  choice: boolean;
  dictation: boolean;
  pronunciation: boolean;
  sentence: boolean;
  dialogue: boolean;
}

export interface DashboardRecord {
  nickname: string | null;
  wordCount: number;
  starterWordCount: number;
  todayPracticeCount: number;
  todayCorrectCount: number;
  todayScore: number;
  dailyScoreGoal: number;
  accuracy: number;
  checkedInToday: boolean;
  checkInDays: number;
  currentStreak: number;
  weakWordCount: number;
  pendingReviewCount: number;
  modules: ModuleAvailability;
}

export interface UserProfile {
  nickname: string | null;
  englishName: string | null;
  avatarPath: string | null;
}

export type ReviewItemType = "WORD" | "SENTENCE" | "DIALOGUE";
export type ReviewItemStatus = "PENDING" | "MASTERED";

export interface ReviewItem {
  type: ReviewItemType;
  key: string;
  status: ReviewItemStatus;
  title: string;
  subtitle: string;
  promptText: string | null;
  referenceAnswer: string | null;
  vocabularyItemId: string | null;
  wrongCount: number;
  correctStreak: number;
  lastWrongAt: Date;
  modes: PracticeMode[];
}

export interface ReviewOverview {
  pendingCount: number;
  masteredCount: number;
  categories: Array<{
    type: ReviewItemType;
    pendingCount: number;
    masteredCount: number;
  }>;
  items: ReviewItem[];
}

export interface WordRecord {
  id: string;
  english: string;
  chinese: string;
  phonetic: string | null;
  source: "STARTER" | "USER" | "LEGACY";
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  lastPracticedAt: Date | null;
}

export interface WordInput {
  english: string;
  chinese: string;
  phonetic?: string;
}

export interface StarterWordRecord {
  key: string;
  category: string;
  english: string;
  chinese: string;
  phonetic: string | null;
  sortOrder: number;
}

export interface ChoiceQuestion {
  questionId: string;
  mode: "LISTEN_CHOOSE_MEANING" | "MEANING_CHOOSE_WORD" | "WORD_CHOOSE_MEANING";
  wordId: string;
  prompt: string;
  audioText: string | null;
  options: Array<{ id: string; text: string }>;
}

export interface PracticeAnswerInput {
  mode:
    | "LISTEN_CHOOSE_MEANING"
    | "MEANING_CHOOSE_WORD"
    | "WORD_CHOOSE_MEANING"
    | "DICTATION";
  wordId: string;
  selectedWordId?: string;
  answerText?: string;
}

export interface PracticeAnswerResult {
  correct: boolean;
  correctWordId: string;
  correctAnswer: string;
  feedback: string;
}

export interface SentencePromptRecord {
  id: string;
  targetWord: string;
  promptChinese: string;
  referenceAnswer: string;
  acceptedAnswers: string[];
  explanation: string;
}

export interface DialoguePromptRecord {
  id: string;
  question: string;
  questionChinese: string;
  referenceAnswer: string;
  acceptedAnswers: string[];
  evaluationHint: string;
}

export interface SemanticEvaluation {
  correct: boolean;
  score: number;
  feedback: string;
  improvedAnswer: string;
  provider: "rules" | "openai" | "zhipu";
}

export interface VoiceEvaluation {
  recognizedText: string;
  pronunciationScore: number;
  accuracyScore: number;
  fluencyScore: number;
  completenessScore: number;
}

export interface CheckInSummary {
  dateKey: string;
  checkedInToday: boolean;
  firstCheckInToday: boolean;
  totalDays: number;
  currentStreak: number;
  todayScore: number;
  wordCount: number;
}

export interface WeakWordRecord {
  id: string;
  english: string;
  chinese: string;
  phonetic: string | null;
  attemptCount: number;
  correctCount: number;
  incorrectCount: number;
  accuracy: number;
}

export interface LearningReportDay {
  dateKey: string;
  score: number;
  attempts: number;
  correct: number;
}

export interface LearningReportMode {
  mode: PracticeMode;
  attempts: number;
  correct: number;
  score: number;
}

export interface LearningReport {
  generatedDate: string;
  wordCount: number;
  totalCheckInDays: number;
  currentStreak: number;
  totalStudyDays: number;
  totalAttempts: number;
  correctAttempts: number;
  totalScore: number;
  accuracy: number;
  masteredWordCount: number;
  learningWordCount: number;
  recentDays: LearningReportDay[];
  modeStats: LearningReportMode[];
  weakWords: WeakWordRecord[];
}

export interface AttemptInput {
  vocabularyItemId?: string;
  mode: PracticeMode;
  result: LearningResult;
  answerText?: string;
  recognizedText?: string;
  feedback?: string;
  semanticScore?: number;
  pronunciationScore?: number;
  accuracyScore?: number;
  fluencyScore?: number;
  completenessScore?: number;
  exerciseKey?: string;
  promptText?: string;
  referenceAnswer?: string;
}
