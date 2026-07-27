import Fastify, { type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { AppConfig } from "./config.js";
import type {
  ChoiceQuestion,
  PracticeAnswerInput,
  ReviewItemStatus,
  ReviewItemType
} from "./domain/types.js";
import { AppError } from "./lib/errors.js";
import type { AppRepository } from "./repositories/app-repository.js";
import { AuthService } from "./services/auth-service.js";
import { assessVoiceAnswer } from "./services/pronunciation-service.js";
import {
  recognizeWordsFromImage,
  type RecognizedWord
} from "./services/image-word-recognizer.js";
import { evaluateSemanticAnswer } from "./services/semantic-evaluator.js";
import { synthesizeSpeech, type SpeechKind } from "./services/speech-service.js";
import { resolveWechatOpenId } from "./services/wechat-service.js";

interface BuildAppOptions {
  repository: AppRepository;
  config: AppConfig;
  wechatResolver?: (code: string, config: AppConfig) => Promise<string>;
  speechResolver?: typeof synthesizeSpeech;
  semanticResolver?: typeof evaluateSemanticAnswer;
  voiceResolver?: typeof assessVoiceAnswer;
  imageWordResolver?: (
    image: Buffer,
    contentType: string,
    config: AppConfig
  ) => Promise<RecognizedWord[]>;
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  return (request.body && typeof request.body === "object" ? request.body : {}) as Record<
    string,
    unknown
  >;
}

function requiredText(body: Record<string, unknown>, key: string, maxLength = 100): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (!value) throw new AppError(400, "INVALID_INPUT", `${key} 不能为空`);
  if (value.length > maxLength) throw new AppError(400, "INVALID_INPUT", `${key} 过长`);
  return value;
}

function optionalText(body: Record<string, unknown>, key: string, maxLength: number): string {
  return typeof body[key] === "string" ? body[key].trim().slice(0, maxLength) : "";
}

function normalizeEnglish(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ");
}

function avatarExtension(content: Buffer): "jpg" | "png" | "webp" | null {
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

const choiceModes = new Set<ChoiceQuestion["mode"]>([
  "LISTEN_CHOOSE_MEANING",
  "MEANING_CHOOSE_WORD",
  "WORD_CHOOSE_MEANING"
]);

export async function buildApp(options: BuildAppOptions) {
  const { repository, config } = options;
  const auth = new AuthService(repository, config);
  const app = Fastify({ logger: config.nodeEnv !== "test", bodyLimit: 1_000_000 });

  await app.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin
  });
  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode >= 400 && statusCode < 500) {
      const clientError = error as { code?: unknown; message?: unknown };
      return reply.status(statusCode).send({
        error:
          typeof clientError.code === "string"
            ? clientError.code
            : "INVALID_REQUEST",
        message: typeof clientError.message === "string" ? clientError.message : "请求格式不正确"
      });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "INTERNAL_ERROR", message: "服务暂时不可用" });
  });

  app.get("/", async () => ({
    service: "English Start API",
    status: "ok",
    health: "/health"
  }));
  app.get("/health", async () => ({ status: "ok" }));

  app.get<{ Params: { fileName: string } }>("/media/avatars/:fileName", async (request, reply) => {
    const fileName = request.params.fileName;
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(fileName)) {
      throw new AppError(404, "AVATAR_NOT_FOUND", "头像不存在");
    }
    try {
      const content = await readFile(path.resolve(config.avatarStoragePath, fileName));
      const extension = path.extname(fileName).slice(1);
      return reply
        .header("Content-Type", extension === "jpg" ? "image/jpeg" : `image/${extension}`)
        .header("Cache-Control", "public, max-age=604800")
        .send(content);
    } catch {
      throw new AppError(404, "AVATAR_NOT_FOUND", "头像不存在");
    }
  });

  app.post("/auth/dev-login", async (request) => {
    if (!config.devLoginEnabled || config.nodeEnv === "production") {
      throw new AppError(404, "NOT_FOUND", "接口不存在");
    }
    const openId = requiredText(bodyRecord(request), "openId", 128);
    return auth.loginWithOpenId(`dev:${openId}`);
  });

  app.post("/auth/wechat", async (request) => {
    const code = requiredText(bodyRecord(request), "code", 256);
    const openId = await (options.wechatResolver || resolveWechatOpenId)(code, config);
    return auth.loginWithOpenId(openId);
  });

  app.get("/me", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getDashboard(current.context);
  });

  app.get("/profile", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getProfile(current.context);
  });

  app.put("/profile", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    return repository.updateProfile(current.context, {
      nickname: optionalText(body, "nickname", 40),
      englishName: optionalText(body, "englishName", 40)
    });
  });

  app.post("/profile/avatar", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const upload = await request.file();
    if (!upload) throw new AppError(400, "AVATAR_REQUIRED", "请选择头像图片");
    const content = await upload.toBuffer();
    if (content.length > 1024 * 1024) {
      throw new AppError(400, "AVATAR_TOO_LARGE", "头像大小不能超过 1MB");
    }
    const extension = avatarExtension(content);
    if (!extension) throw new AppError(400, "INVALID_AVATAR_TYPE", "头像仅支持 JPG、PNG 或 WebP");
    const fileName = `${randomUUID()}.${extension}`;
    await mkdir(path.resolve(config.avatarStoragePath), { recursive: true });
    await writeFile(path.resolve(config.avatarStoragePath, fileName), content);
    const profile = await repository.updateAvatar(current.context, fileName);
    return reply.status(201).send(profile);
  });

  app.put("/me/daily-goal", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const dailyScoreGoal = Number(body.dailyScoreGoal);
    if (!Number.isInteger(dailyScoreGoal) || dailyScoreGoal < 1 || dailyScoreGoal > 999) {
      throw new AppError(400, "INVALID_DAILY_SCORE_GOAL", "达标分数必须是 1-999 的整数");
    }
    return {
      dailyScoreGoal: await repository.updateDailyScoreGoal(
        current.context,
        dailyScoreGoal
      )
    };
  });

  app.post("/check-ins/today", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const result = await repository.checkInToday(current.context);
    return reply.status(result.firstCheckInToday ? 201 : 200).send(result);
  });

  app.get("/reports/learning", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getLearningReport(current.context);
  });

  app.get("/review", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getReviewOverview(current.context);
  });

  app.put("/review/status", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const itemType = requiredText(body, "itemType", 20) as ReviewItemType;
    const itemKey = requiredText(body, "itemKey", 160);
    const status = requiredText(body, "status", 20) as ReviewItemStatus;
    if (!["WORD", "SENTENCE", "DIALOGUE"].includes(itemType)) {
      throw new AppError(400, "INVALID_REVIEW_TYPE", "复习类型不正确");
    }
    if (!["PENDING", "MASTERED"].includes(status)) {
      throw new AppError(400, "INVALID_REVIEW_STATUS", "复习状态不正确");
    }
    await repository.setReviewStatus(current.context, itemType, itemKey, status);
    return { updated: true };
  });

  app.get("/starter-pack", async (request) => {
    await auth.authenticate(request.headers.authorization);
    const words = await repository.listStarterWords();
    return { name: "启蒙 50 词", count: words.length, words };
  });

  app.post("/starter-pack/import", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const result = await repository.importStarterPack(current.context);
    return reply.status(201).send(result);
  });

  app.get("/words", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return { words: await repository.listWords(current.context) };
  });

  app.post("/words", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const word = await repository.addWord(current.context, {
      english: requiredText(body, "english", 80),
      chinese: requiredText(body, "chinese", 120),
      phonetic: optionalText(body, "phonetic", 120)
    });
    return reply.status(201).send({ word });
  });

  app.post("/words/batch", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    if (!Array.isArray(body.words) || !body.words.length || body.words.length > 50) {
      throw new AppError(400, "INVALID_WORD_BATCH", "每次需要确认 1-50 个单词");
    }
    const words = body.words.map((item, index) => {
      if (!item || typeof item !== "object") {
        throw new AppError(400, "INVALID_WORD_BATCH", `第 ${index + 1} 个单词格式不正确`);
      }
      const record = item as Record<string, unknown>;
      return {
        english: requiredText(record, "english", 80),
        chinese: requiredText(record, "chinese", 120)
      };
    });
    const savedWords = await repository.addWords(current.context, words);
    return reply.status(201).send({ saved: savedWords.length, words: savedWords });
  });

  app.post("/words/recognize-image", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const upload = await request.file();
    if (!upload) throw new AppError(400, "IMAGE_REQUIRED", "请拍摄或选择一张图片");
    if (!["image/jpeg", "image/png", "image/webp"].includes(upload.mimetype)) {
      throw new AppError(400, "INVALID_IMAGE_TYPE", "仅支持 JPG、PNG 或 WebP 图片");
    }
    const image = await upload.toBuffer();
    const words = await (options.imageWordResolver || recognizeWordsFromImage)(
      image,
      upload.mimetype,
      config
    );
    return reply.status(200).send({
      words,
      recognized: words.length,
      message: words.length ? "识别完成" : "没有在图片中识别到英文单词"
    });
  });

  app.post<{ Params: { id: string } }>("/words/:id/reading", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const word = await repository.getWord(current.context, request.params.id);
    if (!word) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    const body = bodyRecord(request);
    const result = requiredText(body, "result", 20);
    if (result !== "VIEWED" && result !== "CORRECT" && result !== "INCORRECT") {
      throw new AppError(400, "INVALID_READING_RESULT", "单词学习结果不正确");
    }
    await repository.recordAttempt(current.context, {
      vocabularyItemId: word.id,
      mode: "WORD_READING",
      result,
      exerciseKey: `word:${word.id}`,
      promptText: word.english,
      referenceAnswer: word.chinese,
      feedback:
        result === "CORRECT"
          ? "已经认识"
          : result === "INCORRECT"
            ? "需要继续学习"
            : "已浏览"
    });
    return reply.status(201).send({ recorded: true });
  });

  app.post<{ Params: { id: string } }>("/words/:id/pronunciation", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const word = await repository.getWord(current.context, request.params.id);
    if (!word) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    const upload = await request.file();
    if (!upload) throw new AppError(400, "AUDIO_REQUIRED", "请上传录音");
    const audio = await upload.toBuffer();
    const voice = await (options.voiceResolver || assessVoiceAnswer)(
      audio,
      upload.mimetype,
      config,
      word.english
    );
    const recognizedCorrect =
      normalizeEnglish(voice.recognizedText) === normalizeEnglish(word.english);
    const correct = recognizedCorrect && voice.pronunciationScore >= 60;
    await repository.recordAttempt(current.context, {
      vocabularyItemId: word.id,
      mode: "WORD_READING",
      result: correct ? "CORRECT" : "INCORRECT",
      exerciseKey: `word:${word.id}`,
      promptText: word.english,
      referenceAnswer: word.chinese,
      recognizedText: voice.recognizedText,
      feedback: correct
        ? "发音通过"
        : recognizedCorrect
          ? "再练一次，注意发音清晰度"
          : `识别成了 ${voice.recognizedText}，请跟读 ${word.english}`,
      pronunciationScore: voice.pronunciationScore,
      accuracyScore: voice.accuracyScore,
      fluencyScore: voice.fluencyScore,
      completenessScore: voice.completenessScore
    });
    return reply.status(201).send({
      correct,
      recognizedCorrect,
      feedback: correct
        ? "发音通过"
        : recognizedCorrect
          ? "再练一次，注意发音清晰度"
          : `识别成了 ${voice.recognizedText}，请重新跟读`,
      voice
    });
  });

  app.delete("/words", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return { removed: await repository.archiveAllWords(current.context) };
  });

  app.put<{ Params: { id: string } }>("/words/:id", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const word = await repository.updateWord(current.context, request.params.id, {
      english: requiredText(body, "english", 80),
      chinese: requiredText(body, "chinese", 120),
      phonetic: optionalText(body, "phonetic", 120)
    });
    if (!word) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    return { word };
  });

  app.delete<{ Params: { id: string } }>("/words/:id", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const archived = await repository.archiveWord(current.context, request.params.id);
    if (!archived) throw new AppError(404, "WORD_NOT_FOUND", "词汇不存在");
    return reply.status(204).send();
  });

  app.get("/practice/questions", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const query = request.query as { mode?: string; limit?: string; scope?: string };
    if (!query.mode || !choiceModes.has(query.mode as ChoiceQuestion["mode"])) {
      throw new AppError(400, "INVALID_MODE", "练习模式不正确");
    }
    const scope = query.scope === "weak" ? "weak" : "all";
    const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
    return {
      questions: await repository.getChoiceQuestions(
        current.context,
        query.mode as ChoiceQuestion["mode"],
        limit,
        scope
      )
    };
  });

  app.post("/practice/answers", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const mode = requiredText(body, "mode", 40) as PracticeAnswerInput["mode"];
    if (mode !== "DICTATION" && !choiceModes.has(mode as ChoiceQuestion["mode"])) {
      throw new AppError(400, "INVALID_MODE", "练习模式不正确");
    }
    const result = await repository.answerPractice(current.context, {
      mode,
      wordId: requiredText(body, "wordId", 128),
      selectedWordId: optionalText(body, "selectedWordId", 128) || undefined,
      answerText: optionalText(body, "answerText", 120) || undefined
    });
    return reply.status(201).send(result);
  });

  app.get("/sentences", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const query = request.query as { scope?: string };
    const prompts = await repository.listSentencePrompts(
      current.context,
      query.scope === "weak" ? "weak" : "all"
    );
    return {
      prompts: prompts.map((prompt) => ({
        id: prompt.id,
        promptChinese: prompt.promptChinese
      }))
    };
  });

  app.post<{ Params: { id: string } }>("/sentences/:id/answer", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const prompt = await repository.getSentencePrompt(current.context, request.params.id);
    if (!prompt) throw new AppError(404, "SENTENCE_NOT_FOUND", "造句题不存在或尚未开放");
    const answer = requiredText(bodyRecord(request), "answer", 240);
    const evaluation = await (options.semanticResolver || evaluateSemanticAnswer)(
      {
        question: prompt.promptChinese,
        evaluationHint: `使用 ${prompt.targetWord} 表达给出的中文意思`,
        referenceAnswer: prompt.referenceAnswer,
        acceptedAnswers: prompt.acceptedAnswers,
        answer,
        userId: current.context.userId
      },
      config
    );
    await repository.recordAttempt(current.context, {
      mode: "SENTENCE",
      result: evaluation.correct ? "CORRECT" : "INCORRECT",
      exerciseKey: `sentence:${prompt.id}`,
      promptText: prompt.promptChinese,
      referenceAnswer: prompt.referenceAnswer,
      answerText: answer,
      feedback: evaluation.feedback,
      semanticScore: evaluation.score
    });
    return reply.status(201).send(evaluation);
  });

  app.post<{ Params: { id: string } }>("/sentences/:id/voice-answer", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const prompt = await repository.getSentencePrompt(current.context, request.params.id);
    if (!prompt) throw new AppError(404, "SENTENCE_NOT_FOUND", "造句题不存在或尚未开放");
    const upload = await request.file();
    if (!upload) throw new AppError(400, "AUDIO_REQUIRED", "请上传录音");
    const audio = await upload.toBuffer();
    const voice = await (options.voiceResolver || assessVoiceAnswer)(audio, upload.mimetype, config);
    const semantic = await (options.semanticResolver || evaluateSemanticAnswer)(
      {
        question: prompt.promptChinese,
        evaluationHint: `使用 ${prompt.targetWord} 表达给出的中文意思`,
        referenceAnswer: prompt.referenceAnswer,
        acceptedAnswers: prompt.acceptedAnswers,
        answer: voice.recognizedText,
        userId: current.context.userId
      },
      config
    );
    const correct = semantic.correct && voice.pronunciationScore >= 60;
    await repository.recordAttempt(current.context, {
      mode: "SENTENCE",
      result: correct ? "CORRECT" : "INCORRECT",
      exerciseKey: `sentence:${prompt.id}`,
      promptText: prompt.promptChinese,
      referenceAnswer: prompt.referenceAnswer,
      recognizedText: voice.recognizedText,
      feedback: semantic.feedback,
      semanticScore: semantic.score,
      pronunciationScore: voice.pronunciationScore,
      accuracyScore: voice.accuracyScore,
      fluencyScore: voice.fluencyScore,
      completenessScore: voice.completenessScore
    });
    return reply.status(201).send({ correct, semantic, voice });
  });

  app.get("/dialogues", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const query = request.query as { scope?: string };
    return {
      prompts: await repository.listDialoguePrompts(
        current.context,
        query.scope === "weak" ? "weak" : "all"
      )
    };
  });

  app.post<{ Params: { id: string } }>("/dialogues/:id/text-answer", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const prompt = await repository.getDialoguePrompt(current.context, request.params.id);
    if (!prompt) throw new AppError(404, "DIALOGUE_NOT_FOUND", "对话题不存在或尚未开放");
    const answer = requiredText(bodyRecord(request), "answer", 240);
    const evaluation = await (options.semanticResolver || evaluateSemanticAnswer)(
      {
        question: prompt.question,
        evaluationHint: prompt.evaluationHint,
        referenceAnswer: prompt.referenceAnswer,
        acceptedAnswers: prompt.acceptedAnswers,
        answer,
        userId: current.context.userId
      },
      config
    );
    await repository.recordAttempt(current.context, {
      mode: "DIALOGUE_TEXT",
      result: evaluation.correct ? "CORRECT" : "INCORRECT",
      exerciseKey: `dialogue:${prompt.id}`,
      promptText: prompt.question,
      referenceAnswer: prompt.referenceAnswer,
      answerText: answer,
      feedback: evaluation.feedback,
      semanticScore: evaluation.score
    });
    return reply.status(201).send(evaluation);
  });

  app.post<{ Params: { id: string } }>("/dialogues/:id/voice-answer", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const prompt = await repository.getDialoguePrompt(current.context, request.params.id);
    if (!prompt) throw new AppError(404, "DIALOGUE_NOT_FOUND", "对话题不存在或尚未开放");
    const upload = await request.file();
    if (!upload) throw new AppError(400, "AUDIO_REQUIRED", "请上传录音");
    const audio = await upload.toBuffer();
    const voice = await (options.voiceResolver || assessVoiceAnswer)(audio, upload.mimetype, config);
    const semantic = await (options.semanticResolver || evaluateSemanticAnswer)(
      {
        question: prompt.question,
        evaluationHint: prompt.evaluationHint,
        referenceAnswer: prompt.referenceAnswer,
        acceptedAnswers: prompt.acceptedAnswers,
        answer: voice.recognizedText,
        userId: current.context.userId
      },
      config
    );
    const correct = semantic.correct && voice.pronunciationScore >= 60;
    await repository.recordAttempt(current.context, {
      mode: "DIALOGUE_VOICE",
      result: correct ? "CORRECT" : "INCORRECT",
      exerciseKey: `dialogue:${prompt.id}`,
      promptText: prompt.question,
      referenceAnswer: prompt.referenceAnswer,
      recognizedText: voice.recognizedText,
      feedback: semantic.feedback,
      semanticScore: semantic.score,
      pronunciationScore: voice.pronunciationScore,
      accuracyScore: voice.accuracyScore,
      fluencyScore: voice.fluencyScore,
      completenessScore: voice.completenessScore
    });
    return reply.status(201).send({ correct, semantic, voice });
  });

  app.post("/speech/tts", async (request, reply) => {
    await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const text = requiredText(body, "text", 200);
    const rawSpeed = typeof body.speed === "number" ? body.speed : 0.85;
    const speed = Math.min(1.5, Math.max(0.5, rawSpeed));
    const requestedKind = optionalText(body, "kind", 20) || "auto";
    if (!["auto", "word", "sentence"].includes(requestedKind)) {
      throw new AppError(400, "INVALID_SPEECH_KIND", "语音类型不正确");
    }
    const result = await (options.speechResolver || synthesizeSpeech)(
      text,
      speed,
      config,
      requestedKind as SpeechKind
    );
    return reply
      .header("Content-Type", result.contentType)
      .header("X-Speech-Provider", result.provider)
      .header("X-Speech-Cache", result.cacheStatus)
      .header("Cache-Control", "private, max-age=86400")
      .send(result.audio);
  });

  return app;
}
