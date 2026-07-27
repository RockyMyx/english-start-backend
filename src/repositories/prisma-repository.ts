import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
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

  async getDashboard(context: IdentityContext): Promise<DashboardRecord> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [user, wordCount, starterWordCount, todayAttempts] =
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
        })
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
      modules: {
        choice: wordCount >= 4,
        dictation: wordCount >= 1,
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
      lastPracticedAt: word.progress?.lastPracticedAt || null
    }));
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
      lastPracticedAt: word.progress?.lastPracticedAt || null
    };
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
    limit: number
  ): Promise<ChoiceQuestion[]> {
    const words = await this.client.vocabularyItem.findMany({
      where: { userId: context.userId, archivedAt: null }
    });
    if (words.length < 4) {
      throw new AppError(409, "NOT_ENOUGH_WORDS", "至少需要 4 个词汇才能开始选择题");
    }
    const questions: ChoiceQuestion[] = [];
    for (const target of shuffled(words)) {
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
      feedback: correct ? "回答正确" : `正确答案是 ${word.english}（${word.chinese}）`
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

  async listSentencePrompts(context: IdentityContext): Promise<SentencePromptRecord[]> {
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
    return prompts.filter((prompt) => sentenceCanUseVocabulary(prompt, words));
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

  async listDialoguePrompts(context: IdentityContext): Promise<DialoguePromptRecord[]> {
    const dashboard = await this.getDashboard(context);
    if (!dashboard.modules.dialogue) return [];
    return this.client.dialoguePrompt.findMany({
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
          completenessScore: input.completenessScore
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
