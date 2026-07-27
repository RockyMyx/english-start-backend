import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { AppConfig } from "./config.js";
import type { ChoiceQuestion, PracticeAnswerInput } from "./domain/types.js";
import { AppError } from "./lib/errors.js";
import type { AppRepository } from "./repositories/app-repository.js";
import { AuthService } from "./services/auth-service.js";
import { assessVoiceAnswer } from "./services/pronunciation-service.js";
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
    const query = request.query as { mode?: string; limit?: string };
    if (!query.mode || !choiceModes.has(query.mode as ChoiceQuestion["mode"])) {
      throw new AppError(400, "INVALID_MODE", "练习模式不正确");
    }
    const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
    return {
      questions: await repository.getChoiceQuestions(
        current.context,
        query.mode as ChoiceQuestion["mode"],
        limit
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
    const prompts = await repository.listSentencePrompts(current.context);
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
    return { prompts: await repository.listDialoguePrompts(current.context) };
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
