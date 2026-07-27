import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type {
  AttemptInput,
  CheckInSummary,
  ChoiceQuestion,
  DashboardRecord,
  DialoguePromptRecord,
  IdentityContext,
  LearningReport,
  LearningReportMode,
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
import { currentStreakDays, shanghaiDateKey, shiftDateKey } from "../domain/date-key.js";
import { buildReviewOverview } from "../domain/review.js";
import { DAILY_SCORE_GOAL, scoreForAttempt } from "../domain/scoring.js";
import { sentenceCanUseVocabulary } from "../domain/sentence-coverage.js";
import { AppError } from "../lib/errors.js";
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

  async getDashboard(context: IdentityContext): Promise<DashboardRecord> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayKey = shanghaiDateKey();
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
      accuracy:
        todayPracticeCount > 0 ? Math.round((todayCorrectCount / todayPracticeCount) * 100) : 0,
      checkedInToday: checkIns.some((item) => item.dateKey === todayKey),
      checkInDays: checkIns.length,
      currentStreak: currentStreakDays(checkIns.map((item) => item.dateKey), todayKey),
      weakWordCount,
      pendingReviewCount: review.pendingCount,
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

  async checkInToday(context: IdentityContext): Promise<CheckInSummary> {
    const dateKey = shanghaiDateKey();
    const existing = await this.client.dailyCheckIn.findUnique({
      where: { userId_dateKey: { userId: context.userId, dateKey } },
      select: { id: true }
    });
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
      currentStreak: currentStreakDays(dateRows.map((item) => item.dateKey), dateKey),
      todayScore: dashboard.todayScore,
      wordCount: dashboard.wordCount
    };
  }

  async getLearningReport(context: IdentityContext): Promise<LearningReport> {
    const generatedDate = shanghaiDateKey();
    const [words, attempts, checkIns] = await Promise.all([
      this.client.vocabularyItem.findMany({
        where: { userId: context.userId, archivedAt: null },
        include: { progress: true }
      }),
      this.client.practiceAttempt.findMany({
        where: { userId: context.userId },
        select: { mode: true, result: true, occurredAt: true }
      }),
      this.client.dailyCheckIn.findMany({
        where: { userId: context.userId },
        select: { dateKey: true }
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
      weakWords
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
        select: { itemType: true, itemKey: true, masteredAt: true }
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
    const masteredAt = status === "MASTERED" ? new Date() : null;
    await this.client.reviewItemState.upsert({
      where: {
        userId_itemType_itemKey: { userId: context.userId, itemType, itemKey }
      },
      update: { masteredAt },
      create: { userId: context.userId, itemType, itemKey, masteredAt }
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
      include: { progress: true },
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
      lastPracticedAt: word.progress?.lastPracticedAt || null
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
    scope: "all" | "weak" = "all"
  ): Promise<ChoiceQuestion[]> {
    const words = await this.client.vocabularyItem.findMany({
      where: { userId: context.userId, archivedAt: null }
    });
    if (words.length < 4) {
      throw new AppError(409, "NOT_ENOUGH_WORDS", "至少需要 4 个词汇才能开始选择题");
    }
    let targets = words;
    if (scope === "weak") {
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
          referenceAnswer: input.referenceAnswer
        }
      });
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
    });
  }
}
