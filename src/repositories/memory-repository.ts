import { randomUUID } from "node:crypto";
import type {
  AttemptInput,
  CheckInSummary,
  ChoiceQuestion,
  DailyPlanRecord,
  DailyPlanTask,
  DailyPlanTaskKey,
  DashboardRecord,
  DialoguePromptRecord,
  IdentityContext,
  InitialAssessmentAnswer,
  InitialAssessmentRecord,
  AssessmentScores,
  AssessmentDifficulty,
  LearnerProfile,
  LearningGoal,
  LearningReport,
  LearningGoals,
  LearningReportMode,
  MembershipPaymentOrderRecord,
  MembershipStatus,
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
import {
  currentStreakDays,
  shanghaiDateKey,
  shiftDateKey,
  weekStartDateKey
} from "../domain/date-key.js";
import { buildReviewOverview } from "../domain/review.js";
import { DAILY_SCORE_GOAL, scoreForAttempt } from "../domain/scoring.js";
import { sentenceCanUseVocabulary } from "../domain/sentence-coverage.js";
import {
  initialReviewSchedule,
  updateReviewSchedule
} from "../domain/spaced-repetition.js";
import { buildWordMastery } from "../domain/word-mastery.js";
import { AppError } from "../lib/errors.js";
import { assessmentProfileComplete } from "../services/initial-assessment.js";
import { buildPersonalizedLearningReport } from "../services/personalized-report.js";
import type { AppRepository } from "./app-repository.js";

interface MemoryUser {
  id: string;
  openId: string;
  dailyScoreGoal: number;
  weeklyGoalDays: number;
  nickname: string | null;
  englishName: string | null;
  avatarFileName: string | null;
  membershipExpiresAt: Date | null;
  learnerAgeBand: string | null;
  gradeLevel: string | null;
  englishExperience: string | null;
  learningGoals: LearningGoal[];
  initialAssessments: InitialAssessmentRecord[];
  words: WordRecord[];
  attempts: Array<AttemptInput & { occurredAt: Date }>;
  checkIns: string[];
  reviewStates: Array<{
    itemType: ReviewItemType;
    itemKey: string;
    masteredAt: Date | null;
    reviewStage: number;
    intervalDays: number;
    nextReviewAt: Date | null;
    lastReviewedAt: Date | null;
    lastResult: "VIEWED" | "CORRECT" | "INCORRECT" | null;
    lapseCount: number;
    successfulDays: number;
  }>;
  dailyPlans: Array<{
    id: string;
    dateKey: string;
    tasks: DailyPlanTask[];
    completedAt: Date | null;
  }>;
}

const starterWordData = [
  ["greeting", "hello", "hello", "你好"],
  ["greeting", "goodbye", "goodbye", "再见"],
  ["greeting", "thank-you", "thank you", "谢谢"],
  ["greeting", "name", "name", "名字"],
  ["greeting", "yes", "yes", "是；好的"],
  ["greeting", "no", "no", "不；不是"],
  ["greeting", "good", "good", "好的；不错的"],
  ["greeting", "ok", "OK", "好的；可以"],
  ["number", "one", "one", "一"],
  ["number", "two", "two", "二"],
  ["number", "three", "three", "三"],
  ["number", "four", "four", "四"],
  ["number", "five", "five", "五"],
  ["number", "six", "six", "六"],
  ["number", "seven", "seven", "七"],
  ["number", "eight", "eight", "八"],
  ["number", "nine", "nine", "九"],
  ["number", "ten", "ten", "十"],
  ["question", "what", "what", "什么"],
  ["question", "who", "who", "谁"],
  ["question", "when", "when", "什么时候"],
  ["question", "where", "where", "哪里"],
  ["question", "which", "which", "哪一个"],
  ["question", "how", "how", "怎么；如何"],
  ["question", "how-old", "how old", "多大；几岁"],
  ["question", "how-many", "how many", "多少"],
  ["sentence", "is", "is", "是（用于单数）"],
  ["sentence", "are", "are", "是（用于复数或 you）"],
  ["sentence", "am", "am", "是（用于 I）"],
  ["sentence", "i", "I", "我"],
  ["sentence", "you", "you", "你；你们"],
  ["sentence", "he", "he", "他"],
  ["sentence", "she", "she", "她"],
  ["sentence", "his", "his", "他的"],
  ["sentence", "her", "her", "她的"],
  ["sentence", "it", "it", "它"],
  ["sentence", "this", "this", "这；这个"],
  ["sentence", "that", "that", "那；那个"],
  ["sentence", "my", "my", "我的"],
  ["sentence", "your", "your", "你的；你们的"],
  ["sentence", "me", "me", "我（宾格）"],
  ["sentence", "have", "have", "有"],
  ["sentence", "do", "do", "做；助动词"],
  ["sentence", "like", "like", "喜欢"],
  ["sentence", "want", "want", "想要"],
  ["sentence", "can", "can", "能；会"],
  ["sentence", "not", "not", "不；不是"],
  ["sentence", "a", "a", "一个（用于辅音音素前）"],
  ["sentence", "an", "an", "一个（用于元音音素前）"],
  ["sentence", "the", "the", "这个；那个（定冠词）"],
  ["sentence", "in", "in", "在……里面"],
  ["sentence", "on", "on", "在……上面"],
  ["sentence", "here", "here", "这里"],
  ["sentence", "there", "there", "那里"],
  ["color", "color", "color", "颜色"],
  ["color", "red", "red", "红色"],
  ["color", "yellow", "yellow", "黄色"],
  ["color", "green", "green", "绿色"],
  ["color", "blue", "blue", "蓝色"],
  ["color", "black", "black", "黑色"],
  ["color", "white", "white", "白色"],
  ["school", "book", "book", "书"],
  ["school", "pencil", "pencil", "铅笔"],
  ["school", "bag", "bag", "书包"],
  ["school", "table", "table", "桌子"],
  ["school", "chair", "chair", "椅子"],
  ["fruit", "apple", "apple", "苹果"],
  ["fruit", "banana", "banana", "香蕉"],
  ["life", "cat", "cat", "猫"],
  ["life", "dog", "dog", "狗"]
] as const;

const starterWords: StarterWordRecord[] = starterWordData.map(
  ([category, key, english, chinese], index) => ({
    key,
    category,
    english,
    chinese,
    phonetic: null,
    sortOrder: index + 1
  })
);

const sentencePrompts: SentencePromptRecord[] = [
  {
    id: "sentence-age",
    targetWord: "eight",
    promptChinese: "我八岁。",
    referenceAnswer: "I am eight.",
    acceptedAnswers: ["i am eight", "i'm eight"],
    explanation: "使用 I am + 数字表达年龄。"
  }
];

const dialoguePrompts: DialoguePromptRecord[] = [
  {
    id: "dialogue-age",
    question: "How old are you?",
    questionChinese: "你多大了？",
    referenceAnswer: "I'm eight.",
    acceptedAnswers: ["i am eight", "i'm eight", "eight"],
    evaluationHint: "回答自己的年龄。"
  }
];

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[.,!?;:'"]/g, "").replace(/\s+/g, " ");
}

export class MemoryAppRepository implements AppRepository {
  private users: MemoryUser[] = [];
  private sessions: Array<SessionRecord & { tokenHash: string }> = [];
  private membershipCodes: Array<{
    codeHash: string;
    codeHint: string;
    durationDays: number;
    label: string | null;
    expiresAt: Date | null;
    redeemedAt: Date | null;
    redeemedByUserId: string | null;
  }> = [];
  private membershipPaymentOrders: MembershipPaymentOrderRecord[] = [];

  async ensureIdentity(openId: string): Promise<IdentityContext> {
    let user = this.users.find((item) => item.openId === openId);
    if (!user) {
      user = {
        id: randomUUID(),
        openId,
        dailyScoreGoal: 50,
        weeklyGoalDays: 5,
        nickname: null,
        englishName: null,
        avatarFileName: null,
        membershipExpiresAt: null,
        learnerAgeBand: null,
        gradeLevel: null,
        englishExperience: null,
        learningGoals: [],
        initialAssessments: [],
        words: [],
        attempts: [],
        checkIns: [],
        reviewStates: [],
        dailyPlans: []
      };
      this.users.push(user);
    }
    return { userId: user.id };
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const session = { id: randomUUID(), ...input };
    this.sessions.push(session);
    return session;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessions.find((item) => item.tokenHash === tokenHash) || null;
  }

  async getContext(userId: string): Promise<IdentityContext> {
    if (!this.users.some((item) => item.id === userId)) {
      throw new AppError(401, "USER_NOT_FOUND", "用户不存在");
    }
    return { userId };
  }

  async getMembershipStatus(context: IdentityContext): Promise<MembershipStatus> {
    const expiresAt = this.user(context).membershipExpiresAt;
    return { active: !!expiresAt && expiresAt > new Date(), expiresAt };
  }

  async getWechatOpenId(context: IdentityContext): Promise<string> {
    return this.user(context).openId;
  }

  async createMembershipPaymentOrder(
    context: IdentityContext,
    input: Omit<
      MembershipPaymentOrderRecord,
      "userId" | "status" | "transactionId" | "paidAt" | "deliveredAt"
    >
  ): Promise<MembershipPaymentOrderRecord> {
    const order: MembershipPaymentOrderRecord = {
      ...input,
      userId: context.userId,
      status: "PENDING",
      transactionId: null,
      paidAt: null,
      deliveredAt: null
    };
    this.membershipPaymentOrders.push(order);
    return order;
  }

  async getMembershipPaymentOrder(
    context: IdentityContext,
    outTradeNo: string
  ): Promise<MembershipPaymentOrderRecord | null> {
    return this.membershipPaymentOrders.find(
      (item) => item.userId === context.userId && item.outTradeNo === outTradeNo
    ) || null;
  }

  async fulfillMembershipPaymentOrder(input: {
    outTradeNo: string;
    openId: string;
    productId: string;
    amountFen: number;
    env: 0 | 1;
    transactionId: string | null;
    paidAt: Date;
  }): Promise<MembershipStatus> {
    const order = this.membershipPaymentOrders.find(
      (item) => item.outTradeNo === input.outTradeNo
    );
    const user = this.users.find((item) => item.openId === input.openId);
    if (!order || !user || order.userId !== user.id) {
      throw new AppError(404, "MEMBERSHIP_ORDER_NOT_FOUND", "会员支付订单不存在");
    }
    if (
      order.productId !== input.productId ||
      order.amountFen !== input.amountFen ||
      order.env !== input.env
    ) {
      throw new AppError(409, "MEMBERSHIP_ORDER_MISMATCH", "会员支付订单信息不一致");
    }
    if (order.status === "DELIVERED") {
      return this.getMembershipStatus({ userId: user.id });
    }
    const startsAt = user.membershipExpiresAt && user.membershipExpiresAt > input.paidAt
      ? user.membershipExpiresAt
      : input.paidAt;
    user.membershipExpiresAt = new Date(
      startsAt.getTime() + order.durationDays * 86_400_000
    );
    order.status = "DELIVERED";
    order.transactionId = input.transactionId;
    order.paidAt = input.paidAt;
    order.deliveredAt = new Date();
    return { active: true, expiresAt: user.membershipExpiresAt };
  }

  async setDevelopmentMembership(
    context: IdentityContext,
    active: boolean,
    changedAt: Date
  ): Promise<MembershipStatus> {
    const user = this.user(context);
    user.membershipExpiresAt = active
      ? new Date(changedAt.getTime() + 365 * 86_400_000)
      : null;
    return {
      active,
      expiresAt: user.membershipExpiresAt
    };
  }

  async createMembershipRedemptionCode(input: {
    codeHash: string;
    codeHint: string;
    durationDays: number;
    label?: string;
    expiresAt?: Date;
  }): Promise<void> {
    this.membershipCodes.push({
      ...input,
      label: input.label || null,
      expiresAt: input.expiresAt || null,
      redeemedAt: null,
      redeemedByUserId: null
    });
  }

  async redeemMembershipCode(
    context: IdentityContext,
    codeHash: string,
    redeemedAt: Date
  ): Promise<MembershipStatus> {
    const code = this.membershipCodes.find((item) => item.codeHash === codeHash);
    if (!code || code.redeemedAt || (code.expiresAt && code.expiresAt <= redeemedAt)) {
      throw new AppError(400, "INVALID_REDEMPTION_CODE", "兑换码无效或已使用");
    }
    const user = this.user(context);
    code.redeemedAt = redeemedAt;
    code.redeemedByUserId = context.userId;
    const startsAt =
      user.membershipExpiresAt && user.membershipExpiresAt > redeemedAt
        ? user.membershipExpiresAt
        : redeemedAt;
    user.membershipExpiresAt = new Date(
      startsAt.getTime() + code.durationDays * 86_400_000
    );
    return { active: true, expiresAt: user.membershipExpiresAt };
  }

  async getProfile(context: IdentityContext): Promise<UserProfile> {
    const user = this.user(context);
    return {
      nickname: user.nickname,
      englishName: user.englishName,
      avatarPath: user.avatarFileName ? `/media/avatars/${user.avatarFileName}` : null
    };
  }

  async updateProfile(
    context: IdentityContext,
    input: { nickname?: string; englishName?: string }
  ): Promise<UserProfile> {
    const user = this.user(context);
    if (input.nickname !== undefined) user.nickname = input.nickname || null;
    if (input.englishName !== undefined) user.englishName = input.englishName || null;
    return this.getProfile(context);
  }

  async updateAvatar(context: IdentityContext, avatarFileName: string): Promise<UserProfile> {
    this.user(context).avatarFileName = avatarFileName;
    return this.getProfile(context);
  }

  async getLearnerProfile(context: IdentityContext): Promise<LearnerProfile> {
    const user = this.user(context);
    const profile = {
      ageBand: user.learnerAgeBand,
      gradeLevel: user.gradeLevel,
      englishExperience: user.englishExperience,
      learningGoals: [...user.learningGoals]
    };
    return { ...profile, complete: assessmentProfileComplete(profile) };
  }

  async updateLearnerProfile(
    context: IdentityContext,
    input: Omit<LearnerProfile, "complete">
  ): Promise<LearnerProfile> {
    const user = this.user(context);
    user.learnerAgeBand = input.ageBand;
    user.gradeLevel = input.gradeLevel;
    user.englishExperience = input.englishExperience;
    user.learningGoals = [...input.learningGoals];
    return this.getLearnerProfile(context);
  }

  async getLatestInitialAssessment(
    context: IdentityContext
  ): Promise<InitialAssessmentRecord | null> {
    const assessments = this.user(context).initialAssessments;
    return assessments.length ? assessments[assessments.length - 1] : null;
  }

  async listCompletedAssessments(
    context: IdentityContext,
    limit: number
  ): Promise<InitialAssessmentRecord[]> {
    return this.user(context).initialAssessments
      .filter((assessment) => assessment.status === "COMPLETED")
      .sort(
        (left, right) =>
          (right.completedAt?.getTime() || 0) - (left.completedAt?.getTime() || 0)
      )
      .slice(0, Math.max(1, Math.min(limit, 20)));
  }

  async countCompletedAssessments(context: IdentityContext): Promise<number> {
    return this.user(context).initialAssessments.filter(
      (assessment) => assessment.status === "COMPLETED"
    ).length;
  }

  async createInitialAssessment(
    context: IdentityContext,
    difficulty: AssessmentDifficulty
  ): Promise<InitialAssessmentRecord> {
    const assessment: InitialAssessmentRecord = {
      id: randomUUID(),
      status: "IN_PROGRESS",
      difficulty,
      level: null,
      scores: null,
      summary: null,
      startedAt: new Date(),
      completedAt: null,
      answers: []
    };
    this.user(context).initialAssessments.push(assessment);
    return assessment;
  }

  async saveInitialAssessmentAnswer(
    context: IdentityContext,
    assessmentId: string,
    answer: InitialAssessmentAnswer
  ): Promise<InitialAssessmentRecord> {
    const assessment = this.user(context).initialAssessments.find(
      (item) => item.id === assessmentId && item.status === "IN_PROGRESS"
    );
    if (!assessment) {
      throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
    }
    const existingIndex = assessment.answers.findIndex(
      (item) => item.questionKey === answer.questionKey
    );
    if (existingIndex >= 0) assessment.answers[existingIndex] = answer;
    else assessment.answers.push(answer);
    return assessment;
  }

  async completeInitialAssessment(
    context: IdentityContext,
    assessmentId: string,
    result: { level: string; scores: AssessmentScores; summary: string },
    completedAt: Date
  ): Promise<InitialAssessmentRecord> {
    const assessment = this.user(context).initialAssessments.find(
      (item) => item.id === assessmentId && item.status === "IN_PROGRESS"
    );
    if (!assessment) {
      throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
    }
    assessment.status = "COMPLETED";
    assessment.level = result.level;
    assessment.scores = result.scores;
    assessment.summary = result.summary;
    assessment.completedAt = completedAt;
    return assessment;
  }

  async resetInitialAssessment(context: IdentityContext): Promise<void> {
    this.user(context).initialAssessments = [];
  }

  async getDashboard(context: IdentityContext): Promise<DashboardRecord> {
    const user = this.user(context);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayAttempts = user.attempts.filter((item) => item.occurredAt >= startOfToday);
    const correctAttempts = todayAttempts.filter((item) => item.result === "CORRECT");
    const starterCount = user.words.filter((item) => item.source === "STARTER").length;
    const todayKey = shanghaiDateKey();
    const weekStart = weekStartDateKey(todayKey);
    return {
      nickname: user.nickname,
      wordCount: user.words.length,
      starterWordCount: starterCount,
      todayPracticeCount: todayAttempts.length,
      todayCorrectCount: correctAttempts.length,
      todayScore: correctAttempts.reduce(
        (total, item) => total + scoreForAttempt(item.mode, item.result),
        0
      ),
      dailyScoreGoal: user.dailyScoreGoal || DAILY_SCORE_GOAL,
      weeklyGoalDays: user.weeklyGoalDays || 5,
      weekCompletedDays: user.checkIns.filter(
        (dateKey) => dateKey >= weekStart && dateKey <= todayKey
      ).length,
      accuracy: todayAttempts.length
        ? Math.round((correctAttempts.length / todayAttempts.length) * 100)
        : 0,
      checkedInToday: user.checkIns.includes(todayKey),
      checkInDays: user.checkIns.length,
      currentStreak: currentStreakDays(user.checkIns, todayKey),
      weakWordCount: user.words.filter((word) => word.incorrectCount > 0).length,
      pendingReviewCount: (await this.getReviewOverview(context)).pendingCount,
      membership: {
        active: !!user.membershipExpiresAt && user.membershipExpiresAt > new Date(),
        expiresAt: user.membershipExpiresAt
      },
      modules: {
        reading: user.words.length >= 1,
        choice: user.words.length >= 4,
        dictation: user.words.length >= 1,
        pronunciation: user.words.length >= 1,
        sentence: starterCount >= 12,
        dialogue: starterCount >= 12
      }
    };
  }

  async updateDailyScoreGoal(
    context: IdentityContext,
    dailyScoreGoal: number
  ): Promise<number> {
    const user = this.user(context);
    user.dailyScoreGoal = dailyScoreGoal;
    return user.dailyScoreGoal;
  }

  async updateLearningGoals(
    context: IdentityContext,
    goals: LearningGoals
  ): Promise<LearningGoals> {
    const user = this.user(context);
    user.dailyScoreGoal = goals.dailyScoreGoal;
    user.weeklyGoalDays = goals.weeklyGoalDays;
    return {
      dailyScoreGoal: user.dailyScoreGoal,
      weeklyGoalDays: user.weeklyGoalDays
    };
  }

  async checkInToday(context: IdentityContext): Promise<CheckInSummary> {
    const user = this.user(context);
    const dateKey = shanghaiDateKey();
    const firstCheckInToday = !user.checkIns.includes(dateKey);
    if (firstCheckInToday) {
      const todayAttempts = user.attempts.filter(
        (attempt) =>
          attempt.result !== "VIEWED" &&
          shanghaiDateKey(attempt.occurredAt) === dateKey
      );
      const hasOutputPractice = todayAttempts.some((attempt) =>
        ["SENTENCE", "DIALOGUE_TEXT", "DIALOGUE_VOICE"].includes(attempt.mode)
      );
      if (todayAttempts.length < 3 && !hasOutputPractice) {
        throw new AppError(409, "LEARNING_REQUIRED", "完成一组有效练习后即可签到");
      }
    }
    if (firstCheckInToday) user.checkIns.push(dateKey);
    const dashboard = await this.getDashboard(context);
    return {
      dateKey,
      checkedInToday: true,
      firstCheckInToday,
      totalDays: user.checkIns.length,
      totalStudyDays: user.checkIns.length,
      currentStreak: currentStreakDays(user.checkIns, dateKey),
      weekCompletedDays: dashboard.weekCompletedDays,
      weeklyGoalDays: dashboard.weeklyGoalDays,
      todayScore: dashboard.todayScore,
      wordCount: dashboard.wordCount
    };
  }

  async getTodayDailyPlan(context: IdentityContext): Promise<DailyPlanRecord> {
    const user = this.user(context);
    const dateKey = shanghaiDateKey();
    let plan = user.dailyPlans.find((item) => item.dateKey === dateKey);
    if (!plan) {
      const review = await this.getReviewOverview(context);
      const dueIds = review.items
        .filter(
          (item) =>
            item.type === "WORD" &&
            item.status === "PENDING" &&
            !!item.vocabularyItemId
        )
        .slice(0, 8)
        .map((item) => item.vocabularyItemId as string);
      const dueSet = new Set(dueIds);
      const newIds = user.words
        .filter((word) => word.attemptCount === 0 && !dueSet.has(word.id))
        .slice(0, 5)
        .map((word) => word.id);
      const practicedIds = user.words
        .filter((word) => word.attemptCount > 0)
        .sort(
          (left, right) => right.incorrectCount - left.incorrectCount
        )
        .slice(0, 3)
        .map((word) => word.id);
      const outputIds = practicedIds.length ? practicedIds : newIds.slice(0, 3);
      const tasks: DailyPlanTask[] = [];
      if (dueIds.length && user.words.length >= 4) {
        tasks.push({
          key: "REVIEW",
          title: "到期复习",
          description: "在快要忘记前再练一次",
          mode: "WORD_CHOOSE_MEANING",
          targetCount: dueIds.length,
          wordIds: dueIds,
          completedCount: 0,
          completed: false
        });
      }
      if (newIds.length) {
        tasks.push({
          key: "NEW_WORDS",
          title: "学习新词",
          description: "先听发音，再判断认识或不熟",
          mode: "WORD_READING",
          targetCount: newIds.length,
          wordIds: newIds,
          completedCount: 0,
          completed: false
        });
      }
      if (outputIds.length) {
        tasks.push({
          key: "OUTPUT",
          title: "输出巩固",
          description: "用听写把认识变成真正会用",
          mode: "DICTATION",
          targetCount: outputIds.length,
          wordIds: outputIds,
          completedCount: 0,
          completed: false
        });
      }
      plan = {
        id: randomUUID(),
        dateKey,
        tasks,
        completedAt: null
      };
      user.dailyPlans.push(plan);
    }

    const tasks = plan.tasks.map((task) => {
      const completedCount = Math.min(
        task.targetCount,
        user.attempts.filter(
          (attempt) =>
            attempt.dailyPlanId === plan?.id &&
            attempt.dailyTaskKey === task.key &&
            attempt.result !== "VIEWED"
        ).length
      );
      return {
        ...task,
        completedCount,
        completed: completedCount >= task.targetCount
      };
    });
    const totalCount = tasks.reduce((total, task) => total + task.targetCount, 0);
    const completedCount = tasks.reduce(
      (total, task) => total + task.completedCount,
      0
    );
    const completed = tasks.length > 0 && tasks.every((task) => task.completed);
    if (completed && !plan.completedAt) plan.completedAt = new Date();
    return {
      id: plan.id,
      dateKey,
      estimatedMinutes: Math.max(2, Math.ceil(totalCount / 3)),
      completedCount,
      totalCount,
      completed,
      checkedInToday: user.checkIns.includes(dateKey),
      nextTaskKey: tasks.find((task) => !task.completed)?.key || null,
      tasks
    };
  }

  async getDailyPlanTaskWords(
    context: IdentityContext,
    planId: string,
    taskKey: DailyPlanTaskKey
  ): Promise<WordRecord[]> {
    const user = this.user(context);
    const plan = user.dailyPlans.find((item) => item.id === planId);
    if (!plan) throw new AppError(404, "DAILY_PLAN_NOT_FOUND", "今日学习计划不存在");
    const task = plan.tasks.find((item) => item.key === taskKey);
    if (!task) throw new AppError(404, "DAILY_TASK_NOT_FOUND", "今日学习任务不存在");
    return task.wordIds
      .map((id) => user.words.find((word) => word.id === id))
      .filter((word): word is WordRecord => Boolean(word));
  }

  async getLearningReport(context: IdentityContext): Promise<LearningReport> {
    const user = this.user(context);
    const generatedDate = shanghaiDateKey();
    const gradedAttempts = user.attempts.filter((item) => item.result !== "VIEWED");
    const correctAttempts = gradedAttempts.filter((item) => item.result === "CORRECT").length;
    const recentDays = Array.from({ length: 7 }, (_, index) => {
      const dateKey = shiftDateKey(generatedDate, index - 6);
      const dayAttempts = gradedAttempts.filter(
        (attempt) => shanghaiDateKey(attempt.occurredAt) === dateKey
      );
      return {
        dateKey,
        score: dayAttempts.reduce(
          (total, attempt) => total + scoreForAttempt(attempt.mode, attempt.result),
          0
        ),
        attempts: dayAttempts.length,
        correct: dayAttempts.filter((attempt) => attempt.result === "CORRECT").length
      };
    });
    const modeMap = new Map<LearningReportMode["mode"], LearningReportMode>();
    for (const attempt of gradedAttempts) {
      const current = modeMap.get(attempt.mode) || {
        mode: attempt.mode,
        attempts: 0,
        correct: 0,
        score: 0
      };
      current.attempts += 1;
      current.correct += attempt.result === "CORRECT" ? 1 : 0;
      current.score += scoreForAttempt(attempt.mode, attempt.result);
      modeMap.set(attempt.mode, current);
    }
    const weakWords = user.words
      .map((word) => {
        const attemptCount = word.correctCount + word.incorrectCount;
        return {
          id: word.id,
          english: word.english,
          chinese: word.chinese,
          phonetic: word.phonetic,
          attemptCount,
          correctCount: word.correctCount,
          incorrectCount: word.incorrectCount,
          accuracy: attemptCount ? Math.round((word.correctCount / attemptCount) * 100) : 0
        };
      })
      .filter((word) => word.incorrectCount > 0 && word.accuracy < 80)
      .sort(
        (left, right) =>
          right.incorrectCount - left.incorrectCount || left.accuracy - right.accuracy
      )
      .slice(0, 12);
    const membershipActive = Boolean(
      user.membershipExpiresAt && user.membershipExpiresAt > new Date()
    );
    const baselineAssessment = [...user.initialAssessments]
      .reverse()
      .find((assessment) => assessment.status === "COMPLETED");
    return {
      generatedDate,
      wordCount: user.words.length,
      totalCheckInDays: user.checkIns.length,
      currentStreak: currentStreakDays(user.checkIns, generatedDate),
      totalStudyDays: new Set(
        user.attempts.map((attempt) => shanghaiDateKey(attempt.occurredAt))
      ).size,
      totalAttempts: gradedAttempts.length,
      correctAttempts,
      totalScore: gradedAttempts.reduce(
        (total, attempt) => total + scoreForAttempt(attempt.mode, attempt.result),
        0
      ),
      accuracy: gradedAttempts.length
        ? Math.round((correctAttempts / gradedAttempts.length) * 100)
        : 0,
      masteredWordCount: user.words.filter((word) => {
        const gradedCount = word.correctCount + word.incorrectCount;
        return gradedCount >= 3 && (word.correctCount / gradedCount) * 100 >= 80;
      }).length,
      learningWordCount: user.words.filter((word) => word.attemptCount > 0).length,
      recentDays,
      modeStats: [...modeMap.values()].sort((left, right) => right.attempts - left.attempts),
      weakWords,
      personalizedLocked: !membershipActive,
      personalized: membershipActive
        ? buildPersonalizedLearningReport({
            generatedDate,
            attempts: user.attempts.map((attempt) => ({
              ...attempt,
              vocabularyItemId: attempt.vocabularyItemId || null,
              vocabularyEnglish:
                user.words.find((word) => word.id === attempt.vocabularyItemId)?.english || null,
              answerText: attempt.answerText || null,
              recognizedText: attempt.recognizedText || null,
              promptText: attempt.promptText || null,
              referenceAnswer: attempt.referenceAnswer || null,
              semanticScore: attempt.semanticScore ?? null,
              pronunciationScore: attempt.pronunciationScore ?? null
            })),
            weakWords,
            learningGoals: user.learningGoals,
            baseline:
              baselineAssessment?.level &&
              baselineAssessment.scores &&
              baselineAssessment.completedAt
                ? {
                    level: baselineAssessment.level,
                    scores: baselineAssessment.scores,
                    completedAt: baselineAssessment.completedAt
                  }
                : null
          })
        : null
    };
  }

  async getReviewOverview(context: IdentityContext): Promise<ReviewOverview> {
    const user = this.user(context);
    return buildReviewOverview(
      user.attempts.map((attempt) => ({
        ...attempt,
        vocabularyItemId: attempt.vocabularyItemId || null,
        exerciseKey: attempt.exerciseKey || null,
        promptText: attempt.promptText || null,
        referenceAnswer: attempt.referenceAnswer || null,
        vocabularyItem: attempt.vocabularyItemId
          ? user.words
              .filter((word) => word.id === attempt.vocabularyItemId)
              .map((word) => ({ english: word.english, chinese: word.chinese }))[0] || null
          : null
      })),
      user.reviewStates
    );
  }

  async setReviewStatus(
    context: IdentityContext,
    itemType: ReviewItemType,
    itemKey: string,
    status: ReviewItemStatus
  ): Promise<void> {
    const user = this.user(context);
    const existing = user.reviewStates.find(
      (state) => state.itemType === itemType && state.itemKey === itemKey
    );
    const now = new Date();
    const masteredAt = status === "MASTERED" ? now : null;
    const nextReviewAt =
      status === "MASTERED"
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : now;
    if (existing) {
      existing.masteredAt = masteredAt;
      existing.reviewStage = status === "MASTERED" ? 5 : 0;
      existing.intervalDays = status === "MASTERED" ? 30 : 0;
      existing.nextReviewAt = nextReviewAt;
    } else {
      user.reviewStates.push({
        itemType,
        itemKey,
        masteredAt,
        reviewStage: status === "MASTERED" ? 5 : 0,
        intervalDays: status === "MASTERED" ? 30 : 0,
        nextReviewAt,
        lastReviewedAt: null,
        lastResult: null,
        lapseCount: 0,
        successfulDays: 0
      });
    }
  }

  async listStarterWords(): Promise<StarterWordRecord[]> {
    return starterWords;
  }

  async importStarterPack(context: IdentityContext): Promise<{ imported: number; total: number }> {
    const user = this.user(context);
    let imported = 0;
    for (const starter of starterWords) {
      if (user.words.some((word) => normalized(word.english) === normalized(starter.english))) continue;
      user.words.push({
        id: randomUUID(),
        english: starter.english,
        chinese: starter.chinese,
        phonetic: starter.phonetic,
        source: "STARTER",
        attemptCount: 0,
        correctCount: 0,
        incorrectCount: 0,
        lastPracticedAt: null
      });
      imported += 1;
    }
    return { imported, total: starterWords.length };
  }

  async listWords(context: IdentityContext): Promise<WordRecord[]> {
    const user = this.user(context);
    return user.words.map((word) => ({
      ...word,
      mastery: buildWordMastery(
        user.attempts
          .filter(
            (attempt) =>
              attempt.vocabularyItemId === word.id && attempt.result === "CORRECT"
          )
          .map((attempt) => attempt.mode)
      )
    }));
  }

  async getWord(context: IdentityContext, wordId: string): Promise<WordRecord | null> {
    return this.user(context).words.find((word) => word.id === wordId) || null;
  }

  async addWord(context: IdentityContext, input: WordInput): Promise<WordRecord> {
    const user = this.user(context);
    const existing = user.words.find((word) => normalized(word.english) === normalized(input.english));
    if (existing) {
      existing.english = input.english.trim();
      existing.chinese = input.chinese.trim();
      existing.phonetic = input.phonetic?.trim() || null;
      return existing;
    }
    const word: WordRecord = {
      id: randomUUID(),
      english: input.english.trim(),
      chinese: input.chinese.trim(),
      phonetic: input.phonetic?.trim() || null,
      source: "USER",
      attemptCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      lastPracticedAt: null
    };
    user.words.push(word);
    return word;
  }

  async addWords(context: IdentityContext, inputs: WordInput[]): Promise<WordRecord[]> {
    const results: WordRecord[] = [];
    for (const input of inputs) {
      results.push(await this.addWord(context, input));
    }
    return results;
  }

  async updateWord(
    context: IdentityContext,
    wordId: string,
    input: WordInput
  ): Promise<WordRecord | null> {
    const user = this.user(context);
    const word = user.words.find((item) => item.id === wordId);
    if (!word) return null;
    const conflict = user.words.find(
      (item) => item.id !== wordId && normalized(item.english) === normalized(input.english)
    );
    if (conflict) throw new AppError(409, "WORD_ALREADY_EXISTS", "词库中已经有这个英文词汇");
    word.english = input.english.trim();
    word.chinese = input.chinese.trim();
    word.phonetic = input.phonetic?.trim() || null;
    return word;
  }

  async archiveWord(context: IdentityContext, wordId: string): Promise<boolean> {
    const user = this.user(context);
    const before = user.words.length;
    user.words = user.words.filter((word) => word.id !== wordId);
    return before !== user.words.length;
  }

  async archiveAllWords(context: IdentityContext): Promise<number> {
    const user = this.user(context);
    const removed = user.words.length;
    user.words = [];
    return removed;
  }

  async getChoiceQuestions(
    context: IdentityContext,
    mode: ChoiceQuestion["mode"],
    limit: number,
    scope: "all" | "weak" = "all",
    targetWordIds?: string[]
  ): Promise<ChoiceQuestion[]> {
    const words = this.user(context).words;
    if (words.length < 4) throw new AppError(409, "NOT_ENOUGH_WORDS", "至少需要 4 个词汇");
    let targets = words;
    if (targetWordIds?.length) {
      targets = targetWordIds
        .map((id) => words.find((word) => word.id === id))
        .filter((word): word is WordRecord => Boolean(word));
    } else if (scope === "weak") {
      const review = await this.getReviewOverview(context);
      const pending = new Set(
        review.items
          .filter((item) => item.type === "WORD" && item.status === "PENDING")
          .map((item) => item.vocabularyItemId)
      );
      targets = words.filter((word) => pending.has(word.id));
    }
    return targets.slice(0, limit).map((word) => ({
      questionId: `${mode}:${word.id}`,
      mode,
      wordId: word.id,
      prompt:
        mode === "MEANING_CHOOSE_WORD"
          ? word.chinese
          : mode === "WORD_CHOOSE_MEANING"
            ? word.english
            : "听发音，选择正确的中文",
      audioText: mode === "LISTEN_CHOOSE_MEANING" ? word.english : null,
      options: [word, ...words.filter((option) => option.id !== word.id)]
        .slice(0, 4)
        .map((option) => ({
        id: option.id,
        text: mode === "MEANING_CHOOSE_WORD" ? option.english : option.chinese
        }))
    }));
  }

  async answerPractice(
    context: IdentityContext,
    input: PracticeAnswerInput
  ): Promise<PracticeAnswerResult> {
    const word = this.user(context).words.find((item) => item.id === input.wordId);
    if (!word) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    const correct =
      input.mode === "DICTATION"
        ? normalized(input.answerText || "") === normalized(word.english)
        : input.selectedWordId === word.id;
    await this.recordAttempt(context, {
      vocabularyItemId: word.id,
      mode: input.mode,
      result: correct ? "CORRECT" : "INCORRECT",
      answerText: input.answerText || input.selectedWordId,
      exerciseKey: `word:${word.id}`,
      promptText: word.english,
      referenceAnswer: word.chinese,
      dailyPlanId: input.dailyPlanId,
      dailyTaskKey: input.dailyTaskKey
    });
    return {
      correct,
      correctWordId: word.id,
      correctAnswer:
        input.mode === "DICTATION" || input.mode === "MEANING_CHOOSE_WORD"
          ? word.english
          : word.chinese,
      feedback: correct ? "回答正确" : `正确答案：${word.english} · ${word.chinese}`
    };
  }

  async listSentencePrompts(
    context: IdentityContext,
    scope: "all" | "weak" = "all"
  ): Promise<SentencePromptRecord[]> {
    if (!(await this.getDashboard(context)).modules.sentence) return [];
    const vocabulary = this.user(context).words.map((word) => word.english);
    let prompts = sentencePrompts.filter((prompt) =>
      sentenceCanUseVocabulary(prompt, vocabulary)
    );
    if (scope === "weak") {
      const review = await this.getReviewOverview(context);
      const pending = new Set(
        review.items
          .filter((item) => item.type === "SENTENCE" && item.status === "PENDING")
          .map((item) => item.key)
      );
      prompts = prompts.filter((prompt) => pending.has(`sentence:${prompt.id}`));
    }
    return prompts;
  }

  async getSentencePrompt(
    context: IdentityContext,
    id: string
  ): Promise<SentencePromptRecord | null> {
    if (!(await this.getDashboard(context)).modules.sentence) return null;
    const prompt = sentencePrompts.find((item) => item.id === id) || null;
    if (!prompt) return null;
    const vocabulary = this.user(context).words.map((word) => word.english);
    return sentenceCanUseVocabulary(prompt, vocabulary) ? prompt : null;
  }

  async listDialoguePrompts(
    context: IdentityContext,
    scope: "all" | "weak" = "all"
  ): Promise<DialoguePromptRecord[]> {
    if (!(await this.getDashboard(context)).modules.dialogue) return [];
    if (scope !== "weak") return dialoguePrompts;
    const review = await this.getReviewOverview(context);
    const pending = new Set(
      review.items
        .filter((item) => item.type === "DIALOGUE" && item.status === "PENDING")
        .map((item) => item.key)
    );
    return dialoguePrompts.filter((prompt) => pending.has(`dialogue:${prompt.id}`));
  }

  async getDialoguePrompt(
    context: IdentityContext,
    id: string
  ): Promise<DialoguePromptRecord | null> {
    if (!(await this.getDashboard(context)).modules.dialogue) return null;
    return dialoguePrompts.find((item) => item.id === id) || null;
  }

  async recordAttempt(context: IdentityContext, input: AttemptInput): Promise<void> {
    const user = this.user(context);
    if (input.dailyPlanId || input.dailyTaskKey) {
      if (!input.dailyPlanId || !input.dailyTaskKey) {
        throw new AppError(400, "INVALID_DAILY_TASK", "今日学习任务参数不完整");
      }
      const plan = user.dailyPlans.find((item) => item.id === input.dailyPlanId);
      if (!plan) {
        throw new AppError(404, "DAILY_PLAN_NOT_FOUND", "今日学习计划不存在");
      }
      const task = plan.tasks.find((item) => item.key === input.dailyTaskKey);
      if (!task) {
        throw new AppError(404, "DAILY_TASK_NOT_FOUND", "今日学习任务不存在");
      }
      if (
        task.mode !== input.mode ||
        !input.vocabularyItemId ||
        !task.wordIds.includes(input.vocabularyItemId)
      ) {
        throw new AppError(400, "INVALID_DAILY_TASK_ATTEMPT", "本次练习不属于该学习任务");
      }
    }
    const occurredAt = new Date();
    user.attempts.push({ ...input, occurredAt });
    const dateKey = shanghaiDateKey(occurredAt);
    const todayAttempts = user.attempts.filter(
      (attempt) =>
        attempt.result !== "VIEWED" &&
        shanghaiDateKey(attempt.occurredAt) === dateKey
    );
    const hasOutputPractice = todayAttempts.some((attempt) =>
      ["SENTENCE", "DIALOGUE_TEXT", "DIALOGUE_VOICE"].includes(attempt.mode)
    );
    if (
      (todayAttempts.length >= 3 || hasOutputPractice) &&
      !user.checkIns.includes(dateKey)
    ) {
      user.checkIns.push(dateKey);
    }
    if (!input.vocabularyItemId) return;
    const word = user.words.find((item) => item.id === input.vocabularyItemId);
    if (!word) return;
    word.attemptCount += 1;
    if (input.result === "CORRECT") word.correctCount += 1;
    if (input.result === "INCORRECT") word.incorrectCount += 1;
    word.lastPracticedAt = occurredAt;
    const itemKey = `word:${word.id}`;
    const existingState = user.reviewStates.find(
      (state) => state.itemType === "WORD" && state.itemKey === itemKey
    );
    const nextState = updateReviewSchedule(
      existingState || initialReviewSchedule(),
      input.result,
      word.lastPracticedAt
    );
    if (existingState) {
      Object.assign(existingState, nextState);
    } else {
      user.reviewStates.push({
        itemType: "WORD",
        itemKey,
        ...nextState
      });
    }
  }

  private user(context: IdentityContext): MemoryUser {
    const user = this.users.find((item) => item.id === context.userId);
    if (!user) throw new AppError(401, "USER_NOT_FOUND", "用户不存在");
    return user;
  }
}
