import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
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
  AssessmentDifficulty,
  AssessmentScores,
  LearnerProfile,
  LearningGoal,
  LearningReport,
  LearningGoals,
  LearningReportMode,
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

function normalizeEnglish(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ");
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function membershipStatus(expiresAt: Date | null, now = new Date()): MembershipStatus {
  return {
    active: !!expiresAt && expiresAt.getTime() > now.getTime(),
    expiresAt
  };
}

function assessmentRecord(row: {
  id: string;
  status: string;
  difficulty: string;
  level: string | null;
  scores: unknown;
  summary: string | null;
  startedAt: Date;
  completedAt: Date | null;
  answers: Array<{
    questionKey: string;
    dimension: string;
    result: string;
    answerText: string | null;
    recognizedText: string | null;
    score: number | null;
    pronunciationScore: number | null;
    accuracyScore: number | null;
    fluencyScore: number | null;
    completenessScore: number | null;
  }>;
}): InitialAssessmentRecord {
  return {
    id: row.id,
    status: row.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
    difficulty: row.difficulty as AssessmentDifficulty,
    level: row.level,
    scores: row.scores && typeof row.scores === "object" ? row.scores as AssessmentScores : null,
    summary: row.summary,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    answers: row.answers.map((answer) => ({
      ...answer,
      dimension: answer.dimension as InitialAssessmentAnswer["dimension"],
      result: answer.result as InitialAssessmentAnswer["result"]
    }))
  };
}

function dailyPlanTasks(value: unknown): DailyPlanTask[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DailyPlanTask =>
      !!item &&
      typeof item === "object" &&
      typeof (item as DailyPlanTask).key === "string" &&
      Array.isArray((item as DailyPlanTask).wordIds)
  );
}

export class PrismaAppRepository implements AppRepository {
  readonly client: PrismaClient;

  constructor(connectionString: string) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString })
    });
  }

  async ensureIdentity(openId: string): Promise<IdentityContext> {
    const user = await this.client.user.upsert({
      where: { wechatOpenId: openId },
      update: {},
      create: { wechatOpenId: openId }
    });
    return { userId: user.id };
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return this.client.session.create({ data: input });
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.client.session.findUnique({ where: { tokenHash } });
  }

  async getContext(userId: string): Promise<IdentityContext> {
    const user = await this.client.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new AppError(401, "USER_NOT_FOUND", "用户不存在");
    return { userId: user.id };
  }

  async getMembershipStatus(context: IdentityContext): Promise<MembershipStatus> {
    const user = await this.client.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: { membershipExpiresAt: true }
    });
    return membershipStatus(user.membershipExpiresAt);
  }

  async setDevelopmentMembership(
    context: IdentityContext,
    active: boolean,
    changedAt: Date
  ): Promise<MembershipStatus> {
    const membershipExpiresAt = active
      ? new Date(changedAt.getTime() + 365 * 86_400_000)
      : null;
    await this.client.user.update({
      where: { id: context.userId },
      data: { membershipExpiresAt }
    });
    return membershipStatus(membershipExpiresAt, changedAt);
  }

  async createMembershipRedemptionCode(input: {
    codeHash: string;
    codeHint: string;
    durationDays: number;
    label?: string;
    expiresAt?: Date;
  }): Promise<void> {
    await this.client.membershipRedemptionCode.create({
      data: {
        ...input,
        label: input.label || null,
        expiresAt: input.expiresAt || null
      }
    });
  }

  async redeemMembershipCode(
    context: IdentityContext,
    codeHash: string,
    redeemedAt: Date
  ): Promise<MembershipStatus> {
    return this.client.$transaction(async (tx) => {
      const code = await tx.membershipRedemptionCode.findUnique({ where: { codeHash } });
      if (!code || code.redeemedAt || (code.expiresAt && code.expiresAt <= redeemedAt)) {
        throw new AppError(400, "INVALID_REDEMPTION_CODE", "兑换码无效或已使用");
      }
      const redeemed = await tx.membershipRedemptionCode.updateMany({
        where: {
          id: code.id,
          redeemedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: redeemedAt } }]
        },
        data: { redeemedAt, redeemedByUserId: context.userId }
      });
      if (redeemed.count !== 1) {
        throw new AppError(400, "INVALID_REDEMPTION_CODE", "兑换码无效或已使用");
      }
      const user = await tx.user.findUniqueOrThrow({
        where: { id: context.userId },
        select: { membershipExpiresAt: true }
      });
      const startsAt =
        user.membershipExpiresAt && user.membershipExpiresAt > redeemedAt
          ? user.membershipExpiresAt
          : redeemedAt;
      const expiresAt = new Date(startsAt.getTime() + code.durationDays * 86_400_000);
      await tx.user.update({
        where: { id: context.userId },
        data: { membershipExpiresAt: expiresAt }
      });
      return { active: true, expiresAt };
    });
  }

  async getProfile(context: IdentityContext): Promise<UserProfile> {
    const user = await this.client.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: { nickname: true, englishName: true, avatarFileName: true }
    });
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
    await this.client.user.update({
      where: { id: context.userId },
      data: {
        nickname: input.nickname === undefined ? undefined : input.nickname || null,
        englishName: input.englishName === undefined ? undefined : input.englishName || null
      }
    });
    return this.getProfile(context);
  }

  async updateAvatar(context: IdentityContext, avatarFileName: string): Promise<UserProfile> {
    await this.client.user.update({
      where: { id: context.userId },
      data: { avatarFileName }
    });
    return this.getProfile(context);
  }

  async getLearnerProfile(context: IdentityContext): Promise<LearnerProfile> {
    const user = await this.client.user.findUniqueOrThrow({
      where: { id: context.userId },
      select: {
        learnerAgeBand: true,
        gradeLevel: true,
        englishExperience: true,
        learningGoals: true
      }
    });
    const profile = {
      ageBand: user.learnerAgeBand,
      gradeLevel: user.gradeLevel,
      englishExperience: user.englishExperience,
      learningGoals: user.learningGoals as LearningGoal[]
    };
    return { ...profile, complete: assessmentProfileComplete(profile) };
  }

  async updateLearnerProfile(
    context: IdentityContext,
    input: Omit<LearnerProfile, "complete">
  ): Promise<LearnerProfile> {
    await this.client.user.update({
      where: { id: context.userId },
      data: {
        learnerAgeBand: input.ageBand,
        gradeLevel: input.gradeLevel,
        englishExperience: input.englishExperience,
        learningGoals: input.learningGoals
      }
    });
    return this.getLearnerProfile(context);
  }

  async getLatestInitialAssessment(
    context: IdentityContext
  ): Promise<InitialAssessmentRecord | null> {
    const assessment = await this.client.initialAssessment.findFirst({
      where: { userId: context.userId },
      include: { answers: { orderBy: { answeredAt: "asc" } } },
      orderBy: { startedAt: "desc" }
    });
    return assessment ? assessmentRecord(assessment) : null;
  }

  async listCompletedAssessments(
    context: IdentityContext,
    limit: number
  ): Promise<InitialAssessmentRecord[]> {
    const assessments = await this.client.initialAssessment.findMany({
      where: { userId: context.userId, status: "COMPLETED" },
      include: { answers: { orderBy: { answeredAt: "asc" } } },
      orderBy: { completedAt: "desc" },
      take: Math.max(1, Math.min(limit, 20))
    });
    return assessments.map(assessmentRecord);
  }

  async countCompletedAssessments(context: IdentityContext): Promise<number> {
    return this.client.initialAssessment.count({
      where: { userId: context.userId, status: "COMPLETED" }
    });
  }

  async createInitialAssessment(
    context: IdentityContext,
    difficulty: AssessmentDifficulty
  ): Promise<InitialAssessmentRecord> {
    const assessment = await this.client.initialAssessment.create({
      data: { userId: context.userId, difficulty },
      include: { answers: true }
    });
    return assessmentRecord(assessment);
  }

  async saveInitialAssessmentAnswer(
    context: IdentityContext,
    assessmentId: string,
    answer: InitialAssessmentAnswer
  ): Promise<InitialAssessmentRecord> {
    await this.client.$transaction(async (tx) => {
      const assessment = await tx.initialAssessment.findFirst({
        where: { id: assessmentId, userId: context.userId, status: "IN_PROGRESS" },
        select: { id: true }
      });
      if (!assessment) {
        throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
      }
      await tx.initialAssessmentAnswer.upsert({
        where: { assessmentId_questionKey: { assessmentId, questionKey: answer.questionKey } },
        create: { assessmentId, ...answer },
        update: answer
      });
    });
    const assessment = await this.client.initialAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
      include: { answers: { orderBy: { answeredAt: "asc" } } }
    });
    return assessmentRecord(assessment);
  }

  async completeInitialAssessment(
    context: IdentityContext,
    assessmentId: string,
    result: { level: string; scores: AssessmentScores; summary: string },
    completedAt: Date
  ): Promise<InitialAssessmentRecord> {
    const updated = await this.client.initialAssessment.updateMany({
      where: { id: assessmentId, userId: context.userId, status: "IN_PROGRESS" },
      data: {
        status: "COMPLETED",
        level: result.level,
        scores: result.scores as unknown as Prisma.InputJsonValue,
        summary: result.summary,
        completedAt
      }
    });
    if (updated.count !== 1) {
      throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
    }
    const assessment = await this.client.initialAssessment.findUniqueOrThrow({
      where: { id: assessmentId },
      include: { answers: { orderBy: { answeredAt: "asc" } } }
    });
    return assessmentRecord(assessment);
  }

  async resetInitialAssessment(context: IdentityContext): Promise<void> {
    await this.client.initialAssessment.deleteMany({ where: { userId: context.userId } });
  }

  async getDashboard(context: IdentityContext): Promise<DashboardRecord> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayKey = shanghaiDateKey();
    const weekStart = weekStartDateKey(todayKey);
    const [user, wordCount, starterWordCount, todayAttempts, checkIns, weakWordCount, review] =
      await Promise.all([
        this.client.user.findUniqueOrThrow({ where: { id: context.userId } }),
        this.client.vocabularyItem.count({
          where: { userId: context.userId, archivedAt: null }
        }),
        this.client.vocabularyItem.count({
          where: { userId: context.userId, archivedAt: null, source: "STARTER" }
        }),
        this.client.practiceAttempt.findMany({
          where: {
            userId: context.userId,
            occurredAt: { gte: startOfToday }
          },
          select: { mode: true, result: true }
        }),
        this.client.dailyCheckIn.findMany({
          where: { userId: context.userId },
          select: { dateKey: true },
          orderBy: { dateKey: "desc" }
        }),
        this.client.wordProgress.count({
          where: {
            userId: context.userId,
            incorrectCount: { gt: 0 },
            vocabularyItem: { archivedAt: null }
          }
        }),
        this.getReviewOverview(context)
      ]);
    const todayPracticeCount = todayAttempts.length;
    const todayCorrectCount = todayAttempts.filter((attempt) => attempt.result === "CORRECT").length;
    return {
      nickname: user.nickname,
      wordCount,
      starterWordCount,
      todayPracticeCount,
      todayCorrectCount,
      todayScore: todayAttempts.reduce(
        (total, attempt) => total + scoreForAttempt(attempt.mode, attempt.result),
        0
      ),
      dailyScoreGoal: user.dailyScoreGoal || DAILY_SCORE_GOAL,
      weeklyGoalDays: user.weeklyGoalDays || 5,
      weekCompletedDays: checkIns.filter(
        (item) => item.dateKey >= weekStart && item.dateKey <= todayKey
      ).length,
      accuracy:
        todayPracticeCount > 0 ? Math.round((todayCorrectCount / todayPracticeCount) * 100) : 0,
      checkedInToday: checkIns.some((item) => item.dateKey === todayKey),
      checkInDays: checkIns.length,
      currentStreak: currentStreakDays(checkIns.map((item) => item.dateKey), todayKey),
      weakWordCount,
      pendingReviewCount: review.pendingCount,
      membership: membershipStatus(user.membershipExpiresAt),
      modules: {
        reading: wordCount >= 1,
        choice: wordCount >= 4,
        dictation: wordCount >= 1,
        pronunciation: wordCount >= 1,
        sentence: starterWordCount >= 12,
        dialogue: starterWordCount >= 12
      }
    };
  }

  async updateDailyScoreGoal(
    context: IdentityContext,
    dailyScoreGoal: number
  ): Promise<number> {
    const user = await this.client.user.update({
      where: { id: context.userId },
      data: { dailyScoreGoal },
      select: { dailyScoreGoal: true }
    });
    return user.dailyScoreGoal;
  }

  async updateLearningGoals(
    context: IdentityContext,
    goals: LearningGoals
  ): Promise<LearningGoals> {
    return this.client.user.update({
      where: { id: context.userId },
      data: goals,
      select: { dailyScoreGoal: true, weeklyGoalDays: true }
    });
  }

  async checkInToday(context: IdentityContext): Promise<CheckInSummary> {
    const dateKey = shanghaiDateKey();
    const existing = await this.client.dailyCheckIn.findUnique({
      where: { userId_dateKey: { userId: context.userId, dateKey } },
      select: { id: true }
    });
    if (!existing) {
      const recentAttempts = await this.client.practiceAttempt.findMany({
        where: {
          userId: context.userId,
          result: { not: "VIEWED" },
          occurredAt: { gte: new Date(Date.now() - 36 * 60 * 60 * 1000) }
        },
        select: { mode: true, occurredAt: true }
      });
      const todayAttempts = recentAttempts.filter(
        (attempt) => shanghaiDateKey(attempt.occurredAt) === dateKey
      );
      const hasOutputPractice = todayAttempts.some((attempt) =>
        ["SENTENCE", "DIALOGUE_TEXT", "DIALOGUE_VOICE"].includes(attempt.mode)
      );
      if (todayAttempts.length < 3 && !hasOutputPractice) {
        throw new AppError(409, "LEARNING_REQUIRED", "完成一组有效练习后即可签到");
      }
    }
    await this.client.dailyCheckIn.upsert({
      where: { userId_dateKey: { userId: context.userId, dateKey } },
      update: {},
      create: { userId: context.userId, dateKey }
    });
    const [dateRows, dashboard] = await Promise.all([
      this.client.dailyCheckIn.findMany({
        where: { userId: context.userId },
        select: { dateKey: true },
        orderBy: { dateKey: "desc" }
      }),
      this.getDashboard(context)
    ]);
    return {
      dateKey,
      checkedInToday: true,
      firstCheckInToday: !existing,
      totalDays: dateRows.length,
      totalStudyDays: dateRows.length,
      currentStreak: currentStreakDays(dateRows.map((item) => item.dateKey), dateKey),
      weekCompletedDays: dashboard.weekCompletedDays,
      weeklyGoalDays: dashboard.weeklyGoalDays,
      todayScore: dashboard.todayScore,
      wordCount: dashboard.wordCount
    };
  }

  async getTodayDailyPlan(context: IdentityContext): Promise<DailyPlanRecord> {
    const dateKey = shanghaiDateKey();
    let plan = await this.client.dailyPlan.findUnique({
      where: { userId_dateKey: { userId: context.userId, dateKey } }
    });
    if (!plan) {
      const [words, review] = await Promise.all([
        this.client.vocabularyItem.findMany({
          where: { userId: context.userId, archivedAt: null },
          include: { progress: true },
          orderBy: [{ createdAt: "asc" }, { normalizedEnglish: "asc" }]
        }),
        this.getReviewOverview(context)
      ]);
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
      const newIds = words
        .filter((word) => !word.progress || word.progress.attemptCount === 0)
        .filter((word) => !dueSet.has(word.id))
        .slice(0, 5)
        .map((word) => word.id);
      const practicedIds = words
        .filter((word) => (word.progress?.attemptCount || 0) > 0)
        .sort(
          (left, right) =>
            (right.progress?.incorrectCount || 0) -
            (left.progress?.incorrectCount || 0)
        )
        .slice(0, 3)
        .map((word) => word.id);
      const outputIds = practicedIds.length ? practicedIds : newIds.slice(0, 3);
      const tasks: DailyPlanTask[] = [];
      if (dueIds.length && words.length >= 4) {
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
      plan = await this.client.dailyPlan.create({
        data: {
          userId: context.userId,
          dateKey,
          tasks: tasks as unknown as Prisma.InputJsonValue
        }
      });
    }

    const storedTasks = dailyPlanTasks(plan.tasks);
    const [attempts, checkedIn] = await Promise.all([
      this.client.practiceAttempt.findMany({
        where: { dailyPlanId: plan.id, result: { not: "VIEWED" } },
        select: { dailyTaskKey: true }
      }),
      this.client.dailyCheckIn.findUnique({
        where: { userId_dateKey: { userId: context.userId, dateKey } },
        select: { id: true }
      })
    ]);
    const tasks = storedTasks.map((task) => {
      const completedCount = Math.min(
        task.targetCount,
        attempts.filter((attempt) => attempt.dailyTaskKey === task.key).length
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
    if (completed && !plan.completedAt) {
      await this.client.dailyPlan.update({
        where: { id: plan.id },
        data: { completedAt: new Date() }
      });
    }
    return {
      id: plan.id,
      dateKey,
      estimatedMinutes: Math.max(2, Math.ceil(totalCount / 3)),
      completedCount,
      totalCount,
      completed,
      checkedInToday: Boolean(checkedIn),
      nextTaskKey: tasks.find((task) => !task.completed)?.key || null,
      tasks
    };
  }

  async getDailyPlanTaskWords(
    context: IdentityContext,
    planId: string,
    taskKey: DailyPlanTaskKey
  ): Promise<WordRecord[]> {
    const plan = await this.client.dailyPlan.findFirst({
      where: { id: planId, userId: context.userId }
    });
    if (!plan) throw new AppError(404, "DAILY_PLAN_NOT_FOUND", "今日学习计划不存在");
    const task = dailyPlanTasks(plan.tasks).find((item) => item.key === taskKey);
    if (!task) throw new AppError(404, "DAILY_TASK_NOT_FOUND", "今日学习任务不存在");
    const words = await Promise.all(task.wordIds.map((id) => this.getWord(context, id)));
    return words.filter((word): word is WordRecord => Boolean(word));
  }

  async getLearningReport(context: IdentityContext): Promise<LearningReport> {
    const generatedDate = shanghaiDateKey();
    const [user, words, attempts, checkIns, baseline] = await Promise.all([
      this.client.user.findUniqueOrThrow({
        where: { id: context.userId },
        select: { membershipExpiresAt: true, learningGoals: true }
      }),
      this.client.vocabularyItem.findMany({
        where: { userId: context.userId, archivedAt: null },
        include: { progress: true }
      }),
      this.client.practiceAttempt.findMany({
        where: { userId: context.userId },
        select: {
          mode: true,
          result: true,
          occurredAt: true,
          vocabularyItemId: true,
          answerText: true,
          recognizedText: true,
          promptText: true,
          referenceAnswer: true,
          semanticScore: true,
          pronunciationScore: true,
          vocabularyItem: { select: { english: true } }
        }
      }),
      this.client.dailyCheckIn.findMany({
        where: { userId: context.userId },
        select: { dateKey: true }
      }),
      this.client.initialAssessment.findFirst({
        where: { userId: context.userId, status: "COMPLETED" },
        select: { level: true, scores: true, completedAt: true },
        orderBy: { completedAt: "desc" }
      })
    ]);
    const gradedAttempts = attempts.filter((item) => item.result !== "VIEWED");
    const correctAttempts = gradedAttempts.filter((item) => item.result === "CORRECT").length;
    const recentDateKeys = Array.from({ length: 7 }, (_, index) =>
      shiftDateKey(generatedDate, index - 6)
    );
    const recentDays = recentDateKeys.map((dateKey) => {
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
    const weakWords = words
      .map((word) => {
        const correctCount = word.progress?.correctCount || 0;
        const incorrectCount = word.progress?.incorrectCount || 0;
        const attemptCount = correctCount + incorrectCount;
        return {
          id: word.id,
          english: word.english,
          chinese: word.chinese,
          phonetic: word.phonetic,
          attemptCount,
          correctCount,
          incorrectCount,
          accuracy: attemptCount ? Math.round((correctCount / attemptCount) * 100) : 0
        };
      })
      .filter((word) => word.incorrectCount > 0 && word.accuracy < 80)
      .sort(
        (left, right) =>
          right.incorrectCount - left.incorrectCount || left.accuracy - right.accuracy
      )
      .slice(0, 12);
    const masteredWordCount = words.filter((word) => {
      const correctCount = word.progress?.correctCount || 0;
      const incorrectCount = word.progress?.incorrectCount || 0;
      const gradedCount = correctCount + incorrectCount;
      return gradedCount >= 3 && (correctCount / gradedCount) * 100 >= 80;
    }).length;
    const membership = membershipStatus(user.membershipExpiresAt);
    const personalized = membership.active
      ? buildPersonalizedLearningReport({
          generatedDate,
          attempts: attempts.map((attempt) => ({
            ...attempt,
            vocabularyEnglish: attempt.vocabularyItem?.english || null
          })),
          weakWords,
          learningGoals: user.learningGoals as LearningGoal[],
          baseline:
            baseline?.level && baseline.scores && baseline.completedAt
              ? {
                  level: baseline.level,
                  scores: baseline.scores as unknown as AssessmentScores,
                  completedAt: baseline.completedAt
                }
              : null
        })
      : null;
    return {
      generatedDate,
      wordCount: words.length,
      totalCheckInDays: checkIns.length,
      currentStreak: currentStreakDays(checkIns.map((item) => item.dateKey), generatedDate),
      totalStudyDays: new Set(attempts.map((item) => shanghaiDateKey(item.occurredAt))).size,
      totalAttempts: gradedAttempts.length,
      correctAttempts,
      totalScore: gradedAttempts.reduce(
        (total, attempt) => total + scoreForAttempt(attempt.mode, attempt.result),
        0
      ),
      accuracy: gradedAttempts.length
        ? Math.round((correctAttempts / gradedAttempts.length) * 100)
        : 0,
      masteredWordCount,
      learningWordCount: words.filter((word) => (word.progress?.attemptCount || 0) > 0).length,
      recentDays,
      modeStats: [...modeMap.values()].sort((left, right) => right.attempts - left.attempts),
      weakWords,
      personalizedLocked: !membership.active,
      personalized
    };
  }

  async getReviewOverview(context: IdentityContext): Promise<ReviewOverview> {
    const [attempts, states] = await Promise.all([
      this.client.practiceAttempt.findMany({
        where: { userId: context.userId, result: { not: "VIEWED" } },
        select: {
          vocabularyItemId: true,
          mode: true,
          result: true,
          exerciseKey: true,
          promptText: true,
          referenceAnswer: true,
          occurredAt: true,
          vocabularyItem: { select: { english: true, chinese: true } }
        },
        orderBy: { occurredAt: "asc" }
      }),
      this.client.reviewItemState.findMany({
        where: { userId: context.userId },
        select: {
          itemType: true,
          itemKey: true,
          masteredAt: true,
          reviewStage: true,
          nextReviewAt: true
        }
      })
    ]);
    return buildReviewOverview(attempts, states);
  }

  async setReviewStatus(
    context: IdentityContext,
    itemType: ReviewItemType,
    itemKey: string,
    status: ReviewItemStatus
  ): Promise<void> {
    const now = new Date();
    const masteredAt = status === "MASTERED" ? now : null;
    const nextReviewAt =
      status === "MASTERED"
        ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
        : now;
    await this.client.reviewItemState.upsert({
      where: {
        userId_itemType_itemKey: { userId: context.userId, itemType, itemKey }
      },
      update: {
        masteredAt,
        reviewStage: status === "MASTERED" ? 5 : 0,
        intervalDays: status === "MASTERED" ? 30 : 0,
        nextReviewAt
      },
      create: {
        userId: context.userId,
        itemType,
        itemKey,
        masteredAt,
        reviewStage: status === "MASTERED" ? 5 : 0,
        intervalDays: status === "MASTERED" ? 30 : 0,
        nextReviewAt
      }
    });
  }

  async listStarterWords(): Promise<StarterWordRecord[]> {
    return this.client.starterVocabulary.findMany({
      where: { active: true },
      select: {
        key: true,
        category: true,
        english: true,
        chinese: true,
        phonetic: true,
        sortOrder: true
      },
      orderBy: { sortOrder: "asc" }
    });
  }

  async importStarterPack(
    context: IdentityContext
  ): Promise<{ imported: number; total: number }> {
    const starterWords = await this.client.starterVocabulary.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" }
    });
    let imported = 0;
    await this.client.$transaction(async (tx) => {
      for (const starter of starterWords) {
        const existing = await tx.vocabularyItem.findUnique({
          where: {
            userId_normalizedEnglish: {
              userId: context.userId,
              normalizedEnglish: starter.normalizedEnglish
            }
          }
        });
        if (existing) {
          await tx.vocabularyItem.update({
            where: { id: existing.id },
            data: { archivedAt: null }
          });
          continue;
        }
        await tx.vocabularyItem.create({
          data: {
            userId: context.userId,
            english: starter.english,
            normalizedEnglish: starter.normalizedEnglish,
            chinese: starter.chinese,
            phonetic: starter.phonetic,
            source: "STARTER",
            sourceKey: starter.key
          }
        });
        imported += 1;
      }
    });
    return { imported, total: starterWords.length };
  }

  async listWords(context: IdentityContext): Promise<WordRecord[]> {
    const words = await this.client.vocabularyItem.findMany({
      where: { userId: context.userId, archivedAt: null },
      include: {
        progress: true,
        practiceAttempts: {
          where: { result: "CORRECT" },
          select: { mode: true }
        }
      },
      orderBy: [{ source: "asc" }, { normalizedEnglish: "asc" }]
    });
    return words.map((word) => ({
      id: word.id,
      english: word.english,
      chinese: word.chinese,
      phonetic: word.phonetic,
      source: word.source,
      attemptCount: word.progress?.attemptCount || 0,
      correctCount: word.progress?.correctCount || 0,
      incorrectCount: word.progress?.incorrectCount || 0,
      lastPracticedAt: word.progress?.lastPracticedAt || null,
      mastery: buildWordMastery(word.practiceAttempts.map((attempt) => attempt.mode))
    }));
  }

  async getWord(context: IdentityContext, wordId: string): Promise<WordRecord | null> {
    const word = await this.client.vocabularyItem.findFirst({
      where: { id: wordId, userId: context.userId, archivedAt: null },
      include: { progress: true }
    });
    if (!word) return null;
    return {
      id: word.id,
      english: word.english,
      chinese: word.chinese,
      phonetic: word.phonetic,
      source: word.source,
      attemptCount: word.progress?.attemptCount || 0,
      correctCount: word.progress?.correctCount || 0,
      incorrectCount: word.progress?.incorrectCount || 0,
      lastPracticedAt: word.progress?.lastPracticedAt || null
    };
  }

  async addWord(context: IdentityContext, input: WordInput): Promise<WordRecord> {
    const normalizedEnglish = normalizeEnglish(input.english);
    const existing = await this.client.vocabularyItem.findUnique({
      where: {
        userId_normalizedEnglish: { userId: context.userId, normalizedEnglish }
      },
      include: { progress: true }
    });
    const word = existing
      ? await this.client.vocabularyItem.update({
          where: { id: existing.id },
          data: {
            english: input.english.trim(),
            chinese: input.chinese.trim(),
            phonetic: input.phonetic?.trim() || null,
            archivedAt: null
          },
          include: { progress: true }
        })
      : await this.client.vocabularyItem.create({
          data: {
            userId: context.userId,
            english: input.english.trim(),
            normalizedEnglish,
            chinese: input.chinese.trim(),
            phonetic: input.phonetic?.trim() || null,
            source: "USER"
          },
          include: { progress: true }
        });
    return {
      id: word.id,
      english: word.english,
      chinese: word.chinese,
      phonetic: word.phonetic,
      source: word.source,
      attemptCount: word.progress?.attemptCount || 0,
      correctCount: word.progress?.correctCount || 0,
      incorrectCount: word.progress?.incorrectCount || 0,
      lastPracticedAt: word.progress?.lastPracticedAt || null
    };
  }

  async addWords(context: IdentityContext, inputs: WordInput[]): Promise<WordRecord[]> {
    const wordIds = await this.client.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const input of inputs) {
        const normalizedEnglish = normalizeEnglish(input.english);
        const existing = await tx.vocabularyItem.findUnique({
          where: {
            userId_normalizedEnglish: { userId: context.userId, normalizedEnglish }
          },
          select: { id: true }
        });
        const word = existing
          ? await tx.vocabularyItem.update({
              where: { id: existing.id },
              data: {
                english: input.english.trim(),
                chinese: input.chinese.trim(),
                phonetic: input.phonetic?.trim() || null,
                archivedAt: null
              },
              select: { id: true }
            })
          : await tx.vocabularyItem.create({
              data: {
                userId: context.userId,
                english: input.english.trim(),
                normalizedEnglish,
                chinese: input.chinese.trim(),
                phonetic: input.phonetic?.trim() || null,
                source: "USER"
              },
              select: { id: true }
            });
        ids.push(word.id);
      }
      return ids;
    });
    const words = await Promise.all(wordIds.map((id) => this.getWord(context, id)));
    return words.filter((word): word is WordRecord => Boolean(word));
  }

  async updateWord(
    context: IdentityContext,
    wordId: string,
    input: WordInput
  ): Promise<WordRecord | null> {
    const owned = await this.client.vocabularyItem.findFirst({
      where: { id: wordId, userId: context.userId, archivedAt: null }
    });
    if (!owned) return null;
    const normalizedEnglish = normalizeEnglish(input.english);
    const conflict = await this.client.vocabularyItem.findFirst({
      where: {
        userId: context.userId,
        normalizedEnglish,
        id: { not: wordId }
      }
    });
    if (conflict) {
      throw new AppError(409, "WORD_ALREADY_EXISTS", "词库中已经有这个英文词汇");
    }
    const word = await this.client.vocabularyItem.update({
      where: { id: wordId },
      data: {
        english: input.english.trim(),
        normalizedEnglish,
        chinese: input.chinese.trim(),
        phonetic: input.phonetic?.trim() || null
      },
      include: { progress: true }
    });
    return {
      id: word.id,
      english: word.english,
      chinese: word.chinese,
      phonetic: word.phonetic,
      source: word.source,
      attemptCount: word.progress?.attemptCount || 0,
      correctCount: word.progress?.correctCount || 0,
      incorrectCount: word.progress?.incorrectCount || 0,
      lastPracticedAt: word.progress?.lastPracticedAt || null
    };
  }

  async archiveWord(context: IdentityContext, wordId: string): Promise<boolean> {
    const result = await this.client.vocabularyItem.updateMany({
      where: { id: wordId, userId: context.userId, archivedAt: null },
      data: { archivedAt: new Date() }
    });
    return result.count > 0;
  }

  async archiveAllWords(context: IdentityContext): Promise<number> {
    const result = await this.client.vocabularyItem.updateMany({
      where: { userId: context.userId, archivedAt: null },
      data: { archivedAt: new Date() }
    });
    return result.count;
  }

  async getChoiceQuestions(
    context: IdentityContext,
    mode: ChoiceQuestion["mode"],
    limit: number,
    scope: "all" | "weak" = "all",
    targetWordIds?: string[]
  ): Promise<ChoiceQuestion[]> {
    const words = await this.client.vocabularyItem.findMany({
      where: { userId: context.userId, archivedAt: null }
    });
    if (words.length < 4) {
      throw new AppError(409, "NOT_ENOUGH_WORDS", "至少需要 4 个词汇才能开始选择题");
    }
    let targets = words;
    if (targetWordIds?.length) {
      const targetSet = new Set(targetWordIds);
      targets = targetWordIds
        .map((id) => words.find((word) => word.id === id))
        .filter((word): word is (typeof words)[number] => Boolean(word && targetSet.has(word.id)));
    } else if (scope === "weak") {
      const review = await this.getReviewOverview(context);
      const weakOrder = new Map(
        review.items
          .filter(
            (item) =>
              item.type === "WORD" &&
              item.status === "PENDING" &&
              item.vocabularyItemId
          )
          .map((item, index) => [item.vocabularyItemId as string, index])
      );
      targets = words
        .filter((word) => weakOrder.has(word.id))
        .sort((left, right) => (weakOrder.get(left.id) || 0) - (weakOrder.get(right.id) || 0));
    }
    const questions: ChoiceQuestion[] = [];
    for (const target of shuffled(targets)) {
      const textFor = (word: (typeof words)[number]) =>
        mode === "MEANING_CHOOSE_WORD" ? word.english : word.chinese;
      const distractors = shuffled(
        words.filter(
          (word) =>
            word.id !== target.id &&
            normalizeEnglish(textFor(word)) !== normalizeEnglish(textFor(target))
        )
      ).slice(0, 3);
      if (distractors.length < 3) continue;
      const options = shuffled([target, ...distractors]).map((word) => ({
        id: word.id,
        text: textFor(word)
      }));
      questions.push({
        questionId: `${mode}:${target.id}`,
        mode,
        wordId: target.id,
        prompt:
          mode === "MEANING_CHOOSE_WORD"
            ? target.chinese
            : mode === "WORD_CHOOSE_MEANING"
              ? target.english
              : "听发音，选择正确的中文",
        audioText: mode === "LISTEN_CHOOSE_MEANING" ? target.english : null,
        options
      });
      if (questions.length >= limit) break;
    }
    return questions;
  }

  async answerPractice(
    context: IdentityContext,
    input: PracticeAnswerInput
  ): Promise<PracticeAnswerResult> {
    const word = await this.client.vocabularyItem.findFirst({
      where: { id: input.wordId, userId: context.userId, archivedAt: null }
    });
    if (!word) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    const correct =
      input.mode === "DICTATION"
        ? normalizeEnglish(input.answerText || "") === word.normalizedEnglish
        : input.selectedWordId === word.id;
    await this.recordAttempt(context, {
      vocabularyItemId: word.id,
      mode: input.mode,
      result: correct ? "CORRECT" : "INCORRECT",
      answerText: input.answerText || input.selectedWordId,
      feedback: correct ? "回答正确" : `正确答案是 ${word.english}（${word.chinese}）`,
      exerciseKey: `word:${word.id}`,
      promptText: word.english,
      referenceAnswer: word.chinese
      ,
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
    const dashboard = await this.getDashboard(context);
    if (!dashboard.modules.sentence) return [];
    const [prompts, vocabulary] = await Promise.all([
      this.client.sentencePrompt.findMany({
        where: { active: true },
        select: {
          id: true,
          targetWord: true,
          promptChinese: true,
          referenceAnswer: true,
          acceptedAnswers: true,
          explanation: true
        },
        orderBy: { sortOrder: "asc" }
      }),
      this.client.vocabularyItem.findMany({
        where: { userId: context.userId, archivedAt: null },
        select: { english: true }
      })
    ]);
    const words = vocabulary.map((word) => word.english);
    let available = prompts.filter((prompt) => sentenceCanUseVocabulary(prompt, words));
    if (scope === "weak") {
      const review = await this.getReviewOverview(context);
      const pendingKeys = new Set(
        review.items
          .filter((item) => item.type === "SENTENCE" && item.status === "PENDING")
          .map((item) => item.key)
      );
      available = available.filter((prompt) => pendingKeys.has(`sentence:${prompt.id}`));
    }
    return available;
  }

  async getSentencePrompt(
    context: IdentityContext,
    id: string
  ): Promise<SentencePromptRecord | null> {
    const dashboard = await this.getDashboard(context);
    if (!dashboard.modules.sentence) return null;
    const [prompt, vocabulary] = await Promise.all([
      this.client.sentencePrompt.findFirst({
        where: { id, active: true },
        select: {
          id: true,
          targetWord: true,
          promptChinese: true,
          referenceAnswer: true,
          acceptedAnswers: true,
          explanation: true
        }
      }),
      this.client.vocabularyItem.findMany({
        where: { userId: context.userId, archivedAt: null },
        select: { english: true }
      })
    ]);
    if (!prompt) return null;
    return sentenceCanUseVocabulary(
      prompt,
      vocabulary.map((word) => word.english)
    )
      ? prompt
      : null;
  }

  async listDialoguePrompts(
    context: IdentityContext,
    scope: "all" | "weak" = "all"
  ): Promise<DialoguePromptRecord[]> {
    const dashboard = await this.getDashboard(context);
    if (!dashboard.modules.dialogue) return [];
    const prompts = await this.client.dialoguePrompt.findMany({
      where: { active: true },
      select: {
        id: true,
        question: true,
        questionChinese: true,
        referenceAnswer: true,
        acceptedAnswers: true,
        evaluationHint: true
      },
      orderBy: { sortOrder: "asc" }
    });
    if (scope !== "weak") return prompts;
    const review = await this.getReviewOverview(context);
    const pendingKeys = new Set(
      review.items
        .filter((item) => item.type === "DIALOGUE" && item.status === "PENDING")
        .map((item) => item.key)
    );
    return prompts.filter((prompt) => pendingKeys.has(`dialogue:${prompt.id}`));
  }

  async getDialoguePrompt(
    context: IdentityContext,
    id: string
  ): Promise<DialoguePromptRecord | null> {
    const dashboard = await this.getDashboard(context);
    if (!dashboard.modules.dialogue) return null;
    return this.client.dialoguePrompt.findFirst({
      where: { id, active: true },
      select: {
        id: true,
        question: true,
        questionChinese: true,
        referenceAnswer: true,
        acceptedAnswers: true,
        evaluationHint: true
      }
    });
  }

  async recordAttempt(context: IdentityContext, input: AttemptInput): Promise<void> {
    const now = new Date();
    await this.client.$transaction(async (tx) => {
      if (input.dailyPlanId || input.dailyTaskKey) {
        if (!input.dailyPlanId || !input.dailyTaskKey) {
          throw new AppError(400, "INVALID_DAILY_TASK", "今日学习任务参数不完整");
        }
        const plan = await tx.dailyPlan.findFirst({
          where: { id: input.dailyPlanId, userId: context.userId },
          select: { tasks: true }
        });
        if (!plan) {
          throw new AppError(404, "DAILY_PLAN_NOT_FOUND", "今日学习计划不存在");
        }
        const task = dailyPlanTasks(plan.tasks).find(
          (item) => item.key === input.dailyTaskKey
        );
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
      await tx.practiceAttempt.create({
        data: {
          userId: context.userId,
          vocabularyItemId: input.vocabularyItemId,
          mode: input.mode,
          result: input.result,
          answerText: input.answerText,
          recognizedText: input.recognizedText,
          feedback: input.feedback,
          semanticScore: input.semanticScore,
          pronunciationScore: input.pronunciationScore,
          accuracyScore: input.accuracyScore,
          fluencyScore: input.fluencyScore,
          completenessScore: input.completenessScore,
          exerciseKey: input.exerciseKey,
          promptText: input.promptText,
          referenceAnswer: input.referenceAnswer,
          dailyPlanId: input.dailyPlanId,
          dailyTaskKey: input.dailyTaskKey
        }
      });
      const dateKey = shanghaiDateKey(now);
      const existingCheckIn = await tx.dailyCheckIn.findUnique({
        where: { userId_dateKey: { userId: context.userId, dateKey } },
        select: { id: true }
      });
      if (!existingCheckIn) {
        const todayAttempts = (
          await tx.practiceAttempt.findMany({
            where: { userId: context.userId, result: { not: "VIEWED" } },
            select: { occurredAt: true, mode: true }
          })
        ).filter((attempt) => shanghaiDateKey(attempt.occurredAt) === dateKey);
        const hasOutputPractice = todayAttempts.some((attempt) =>
          ["SENTENCE", "DIALOGUE_TEXT", "DIALOGUE_VOICE"].includes(attempt.mode)
        );
        if (todayAttempts.length >= 3 || hasOutputPractice) {
          await tx.dailyCheckIn.create({
            data: { userId: context.userId, dateKey }
          });
        }
      }
      if (!input.vocabularyItemId) return;
      const isCorrect = input.result === "CORRECT";
      const isIncorrect = input.result === "INCORRECT";
      await tx.wordProgress.upsert({
        where: {
          userId_vocabularyItemId: {
            userId: context.userId,
            vocabularyItemId: input.vocabularyItemId
          }
        },
        update: {
          attemptCount: { increment: 1 },
          correctCount: isCorrect ? { increment: 1 } : undefined,
          incorrectCount: isIncorrect ? { increment: 1 } : undefined,
          lastPracticedAt: now
        },
        create: {
          userId: context.userId,
          vocabularyItemId: input.vocabularyItemId,
          attemptCount: 1,
          correctCount: isCorrect ? 1 : 0,
          incorrectCount: isIncorrect ? 1 : 0,
          lastPracticedAt: now
        }
      });
      const itemType: ReviewItemType = "WORD";
      const itemKey = `word:${input.vocabularyItemId}`;
      const existingState = await tx.reviewItemState.findUnique({
        where: {
          userId_itemType_itemKey: {
            userId: context.userId,
            itemType,
            itemKey
          }
        }
      });
      const nextState = updateReviewSchedule(
        existingState || initialReviewSchedule(),
        input.result,
        now
      );
      await tx.reviewItemState.upsert({
        where: {
          userId_itemType_itemKey: {
            userId: context.userId,
            itemType,
            itemKey
          }
        },
        update: nextState,
        create: {
          userId: context.userId,
          itemType,
          itemKey,
          ...nextState
        }
      });
    });
  }
}
