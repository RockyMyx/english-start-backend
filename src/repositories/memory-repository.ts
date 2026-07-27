import { randomUUID } from "node:crypto";
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

interface MemoryUser {
  id: string;
  openId: string;
  dailyScoreGoal: number;
  words: WordRecord[];
  attempts: Array<AttemptInput & { occurredAt: Date }>;
}

const starterWordData = [
  ["greeting", "hello", "hello", "你好"],
  ["greeting", "goodbye", "goodbye", "再见"],
  ["greeting", "thank-you", "thank you", "谢谢"],
  ["greeting", "name", "name", "名字"],
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
  ["color", "color", "color", "颜色"],
  ["color", "red", "red", "红色"],
  ["color", "yellow", "yellow", "黄色"],
  ["color", "green", "green", "绿色"],
  ["color", "blue", "blue", "蓝色"],
  ["color", "black", "black", "黑色"],
  ["color", "white", "white", "白色"],
  ["color", "pink", "pink", "粉色"],
  ["school", "book", "book", "书"],
  ["school", "pencil", "pencil", "铅笔"],
  ["school", "bag", "bag", "书包"],
  ["school", "desk", "desk", "课桌"],
  ["school", "chair", "chair", "椅子"],
  ["fruit", "apple", "apple", "苹果"],
  ["fruit", "banana", "banana", "香蕉"],
  ["life", "mother", "mother", "妈妈"],
  ["life", "father", "father", "爸爸"],
  ["life", "sister", "sister", "姐妹"],
  ["life", "brother", "brother", "兄弟"],
  ["life", "cat", "cat", "猫"],
  ["life", "dog", "dog", "狗"],
  ["life", "happy", "happy", "开心的"],
  ["life", "sad", "sad", "难过的"]
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

  async ensureIdentity(openId: string): Promise<IdentityContext> {
    let user = this.users.find((item) => item.openId === openId);
    if (!user) {
      user = { id: randomUUID(), openId, dailyScoreGoal: 50, words: [], attempts: [] };
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

  async getDashboard(context: IdentityContext): Promise<DashboardRecord> {
    const user = this.user(context);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayAttempts = user.attempts.filter((item) => item.occurredAt >= startOfToday);
    const correctAttempts = todayAttempts.filter((item) => item.result === "CORRECT");
    const starterCount = user.words.filter((item) => item.source === "STARTER").length;
    return {
      nickname: null,
      wordCount: user.words.length,
      starterWordCount: starterCount,
      todayPracticeCount: todayAttempts.length,
      todayCorrectCount: correctAttempts.length,
      todayScore: correctAttempts.reduce(
        (total, item) => total + scoreForAttempt(item.mode, item.result),
        0
      ),
      dailyScoreGoal: user.dailyScoreGoal || DAILY_SCORE_GOAL,
      accuracy: todayAttempts.length
        ? Math.round((correctAttempts.length / todayAttempts.length) * 100)
        : 0,
      modules: {
        choice: user.words.length >= 4,
        dictation: user.words.length >= 1,
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
        lastPracticedAt: null
      });
      imported += 1;
    }
    return { imported, total: starterWords.length };
  }

  async listWords(context: IdentityContext): Promise<WordRecord[]> {
    return [...this.user(context).words];
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
      lastPracticedAt: null
    };
    user.words.push(word);
    return word;
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
    limit: number
  ): Promise<ChoiceQuestion[]> {
    const words = this.user(context).words;
    if (words.length < 4) throw new AppError(409, "NOT_ENOUGH_WORDS", "至少需要 4 个词汇");
    return words.slice(0, limit).map((word) => ({
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
      options: words.slice(0, 4).map((option) => ({
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
      answerText: input.answerText || input.selectedWordId
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
    if (!(await this.getDashboard(context)).modules.sentence) return [];
    const vocabulary = this.user(context).words.map((word) => word.english);
    return sentencePrompts.filter((prompt) => sentenceCanUseVocabulary(prompt, vocabulary));
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

  async listDialoguePrompts(context: IdentityContext): Promise<DialoguePromptRecord[]> {
    return (await this.getDashboard(context)).modules.dialogue ? dialoguePrompts : [];
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
    user.attempts.push({ ...input, occurredAt: new Date() });
    if (!input.vocabularyItemId) return;
    const word = user.words.find((item) => item.id === input.vocabularyItemId);
    if (!word) return;
    word.attemptCount += 1;
    if (input.result === "CORRECT") word.correctCount += 1;
    word.lastPracticedAt = new Date();
  }

  private user(context: IdentityContext): MemoryUser {
    const user = this.users.find((item) => item.id === context.userId);
    if (!user) throw new AppError(401, "USER_NOT_FOUND", "用户不存在");
    return user;
  }
}
