export type PracticeMode =
  | "WORD_READING"
  | "WORD_PRONUNCIATION"
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

export interface MembershipStatus {
  active: boolean;
  expiresAt: Date | null;
}

export type MembershipPaymentStatus = "PENDING" | "DELIVERED";

export interface MembershipPaymentOrderRecord {
  outTradeNo: string;
  userId: string;
  productId: string;
  amountFen: number;
  durationDays: number;
  env: 0 | 1;
  status: MembershipPaymentStatus;
  transactionId: string | null;
  paidAt: Date | null;
  deliveredAt: Date | null;
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
  weeklyGoalDays: number;
  weekCompletedDays: number;
  accuracy: number;
  checkedInToday: boolean;
  checkInDays: number;
  currentStreak: number;
  weakWordCount: number;
  pendingReviewCount: number;
  membership: MembershipStatus;
  modules: ModuleAvailability;
}

export interface LearningGoals {
  dailyScoreGoal: number;
  weeklyGoalDays: number;
}

export interface UserProfile {
  nickname: string | null;
  englishName: string | null;
  avatarPath: string | null;
}

export type LearningGoal =
  | "BALANCED"
  | "VOCABULARY"
  | "SPELLING"
  | "PRONUNCIATION"
  | "SPEAKING"
  | "SCHOOL";

export interface LearnerProfile {
  ageBand: string | null;
  gradeLevel: string | null;
  englishExperience: string | null;
  learningGoals: LearningGoal[];
  complete: boolean;
}

export type AssessmentDimension =
  | "RECOGNITION"
  | "SPELLING"
  | "PRONUNCIATION"
  | "EXPRESSION";

export type AssessmentQuestionType = "CHOICE" | "TEXT" | "VOICE";
export type AssessmentAnswerResult = "CORRECT" | "INCORRECT" | "SKIPPED";
export type AssessmentDifficulty = "FOUNDATION" | "STANDARD" | "ADVANCED";

export interface InitialAssessmentQuestion {
  key: string;
  dimension: AssessmentDimension;
  type: AssessmentQuestionType;
  prompt: string;
  instruction: string;
  audioText: string | null;
  options: Array<{ id: string; text: string }>;
}

export interface InitialAssessmentAnswer {
  questionKey: string;
  dimension: AssessmentDimension;
  result: AssessmentAnswerResult;
  answerText: string | null;
  recognizedText: string | null;
  score: number | null;
  pronunciationScore: number | null;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
}

export interface AssessmentScores {
  recognition: number | null;
  spelling: number | null;
  pronunciation: number | null;
  expression: number | null;
}

export interface InitialAssessmentRecord {
  id: string;
  status: "IN_PROGRESS" | "COMPLETED";
  difficulty: AssessmentDifficulty;
  level: string | null;
  scores: AssessmentScores | null;
  summary: string | null;
  startedAt: Date;
  completedAt: Date | null;
  answers: InitialAssessmentAnswer[];
}

export interface InitialAssessmentResult {
  id: string;
  level: string;
  scores: AssessmentScores;
  summary: string;
  completedAt: Date;
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
  nextReviewAt: Date | null;
  reviewStage: number;
  modes: PracticeMode[];
}

export interface ReviewOverview {
  dueCount: number;
  upcomingCount: number;
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
  mastery?: WordMastery;
}

export type WordMasteryStepKey =
  | "RECOGNITION"
  | "LISTENING"
  | "SPELLING"
  | "SPEAKING"
  | "USAGE";

export interface WordMastery {
  completedCount: number;
  levelName: string;
  steps: Array<{
    key: WordMasteryStepKey;
    label: string;
    completed: boolean;
  }>;
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
  dailyPlanId?: string;
  dailyTaskKey?: DailyPlanTaskKey;
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
  totalStudyDays: number;
  currentStreak: number;
  weekCompletedDays: number;
  weeklyGoalDays: number;
  todayScore: number;
  wordCount: number;
}

export type DailyPlanTaskKey = "REVIEW" | "NEW_WORDS" | "OUTPUT";

export interface DailyPlanTask {
  key: DailyPlanTaskKey;
  title: string;
  description: string;
  mode: PracticeMode;
  targetCount: number;
  wordIds: string[];
  completedCount: number;
  completed: boolean;
}

export interface DailyPlanRecord {
  id: string;
  dateKey: string;
  estimatedMinutes: number;
  completedCount: number;
  totalCount: number;
  completed: boolean;
  checkedInToday: boolean;
  nextTaskKey: DailyPlanTaskKey | null;
  tasks: DailyPlanTask[];
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

export type CapabilityKey = "RECOGNITION" | "SPELLING" | "PRONUNCIATION" | "EXPRESSION";

export interface PersonalizedCapability {
  key: CapabilityKey;
  label: string;
  performance: string;
  basis: string;
  trend: "UP" | "STABLE" | "DOWN" | "INSUFFICIENT";
}

export interface PersonalizedLearningReport {
  summary: string;
  baseline: {
    level: string;
    scores: AssessmentScores;
    completedAt: Date;
  } | null;
  capabilities: PersonalizedCapability[];
  evidence: {
    newlyMasteredWords: string[];
    expressions: string[];
    pronunciationHighlights: string[];
    confusions: string[];
  };
  nextStep: string;
  focusDimensions: CapabilityKey[];
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
  personalizedLocked: boolean;
  personalized: PersonalizedLearningReport | null;
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
  dailyPlanId?: string;
  dailyTaskKey?: DailyPlanTaskKey;
}
