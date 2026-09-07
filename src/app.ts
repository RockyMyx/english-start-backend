import Fastify, { type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { AppConfig } from "./config.js";
import type {
  ChoiceQuestion,
  DailyPlanTaskKey,
  InitialAssessmentAnswer,
  PracticeAnswerInput,
  ReviewItemStatus,
  ReviewItemType
} from "./domain/types.js";
import { AppError } from "./lib/errors.js";
import type { AppRepository } from "./repositories/app-repository.js";
import { AuthService } from "./services/auth-service.js";
import {
  AGE_BANDS,
  ENGLISH_EXPERIENCES,
  GRADE_LEVELS,
  LEARNING_GOALS,
  assessmentProfileComplete,
  assessmentDifficultyForExperience,
  assessmentQuestion,
  assessmentQuestions,
  assessmentReferenceText,
  assessTextAnswer,
  calculateAssessmentResult,
  validateLearnerProfile
} from "./services/initial-assessment.js";
import {
  redemptionCodeHash,
  requireMembership
} from "./services/membership-service.js";
import {
  createMembershipTradeNo,
  createVirtualPaymentParameters,
  membershipProduct,
  parseGoodsDeliveryNotification,
  queryVirtualPaymentOrder,
  requireVirtualPayment,
  verifyWechatMessageSignature,
  type VirtualPaymentQueryResult
} from "./services/virtual-payment-service.js";
import { assessVoiceAnswer } from "./services/pronunciation-service.js";
import {
  recognizeWordsFromImage,
  type RecognizedWord
} from "./services/image-word-recognizer.js";
import { evaluateSemanticAnswer } from "./services/semantic-evaluator.js";
import { synthesizeSpeech, type SpeechKind } from "./services/speech-service.js";
import {
  resolveWechatSession,
  type WechatSession
} from "./services/wechat-service.js";

interface BuildAppOptions {
  repository: AppRepository;
  config: AppConfig;
  wechatResolver?: (code: string, config: AppConfig) => Promise<WechatSession>;
  virtualPaymentQueryResolver?: (
    config: AppConfig,
    openId: string,
    outTradeNo: string
  ) => Promise<VirtualPaymentQueryResult>;
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
  app.addContentTypeParser(
    ["text/xml", "application/xml"],
    { parseAs: "string" },
    (_request, body, done) => done(null, body)
  );

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

  app.get("/media/membership-product.png", async (_request, reply) => {
    try {
      const content = await readFile(path.resolve("images", "membership-year.png"));
      return reply
        .header("Content-Type", "image/png")
        .header("Cache-Control", "public, max-age=604800")
        .send(content);
    } catch {
      throw new AppError(404, "MEMBERSHIP_PRODUCT_IMAGE_NOT_FOUND", "会员商品图片不存在");
    }
  });

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
    const session = await (options.wechatResolver || resolveWechatSession)(code, config);
    return auth.loginWithOpenId(session.openId);
  });

  app.get("/me", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getDashboard(current.context);
  });

  app.get("/membership", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return {
      ...await repository.getMembershipStatus(current.context),
      product: membershipProduct(config)
    };
  });

  app.post("/membership/payment/orders", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    requireVirtualPayment(config);
    const code = requiredText(bodyRecord(request), "code", 256);
    const wechatSession = await (options.wechatResolver || resolveWechatSession)(code, config);
    const expectedOpenId = await repository.getWechatOpenId(current.context);
    if (wechatSession.openId !== expectedOpenId) {
      throw new AppError(403, "WECHAT_IDENTITY_MISMATCH", "微信身份与当前登录用户不一致，请重新登录");
    }
    const order = await repository.createMembershipPaymentOrder(current.context, {
      outTradeNo: createMembershipTradeNo(),
      productId: config.wechatVirtualPaymentProductId,
      amountFen: config.membershipPriceFen,
      durationDays: config.membershipDurationDays,
      env: config.wechatVirtualPaymentEnv
    });
    return reply.status(201).send({
      payment: createVirtualPaymentParameters(config, order, wechatSession.sessionKey),
      product: membershipProduct(config)
    });
  });

  app.post<{ Params: { outTradeNo: string } }>(
    "/membership/payment/orders/:outTradeNo/confirm",
    async (request) => {
      const current = await auth.authenticate(request.headers.authorization);
      requireVirtualPayment(config);
      const order = await repository.getMembershipPaymentOrder(
        current.context,
        request.params.outTradeNo
      );
      if (!order) {
        throw new AppError(404, "MEMBERSHIP_ORDER_NOT_FOUND", "会员支付订单不存在");
      }
      if (order.status === "DELIVERED") {
        return {
          status: "DELIVERED",
          membership: await repository.getMembershipStatus(current.context)
        };
      }
      const openId = await repository.getWechatOpenId(current.context);
      const payment = await (options.virtualPaymentQueryResolver || queryVirtualPaymentOrder)(
        config,
        openId,
        order.outTradeNo
      );
      if ([2, 3, 4].includes(payment.status)) {
        if (payment.paidFee !== order.amountFen) {
          throw new AppError(409, "MEMBERSHIP_PAYMENT_AMOUNT_MISMATCH", "会员支付金额不正确");
        }
        const membership = await repository.fulfillMembershipPaymentOrder({
          outTradeNo: order.outTradeNo,
          openId,
          productId: order.productId,
          amountFen: payment.paidFee,
          env: order.env,
          transactionId: payment.transactionId,
          paidAt: payment.paidAt || new Date()
        });
        return { status: "DELIVERED", membership };
      }
      return {
        status: payment.status === 5 || payment.status === 6 || payment.status === 8
          ? "CLOSED"
          : "PENDING",
        membership: await repository.getMembershipStatus(current.context)
      };
    }
  );

  app.post("/membership/redeem", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const code = requiredText(bodyRecord(request), "code", 64);
    const membership = await repository.redeemMembershipCode(
      current.context,
      redemptionCodeHash(code),
      new Date()
    );
    return membership;
  });

  app.put("/membership/dev-status", async (request) => {
    if (config.nodeEnv === "production" || !config.devLoginEnabled) {
      throw new AppError(404, "NOT_FOUND", "接口不存在");
    }
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    if (typeof body.active !== "boolean") {
      throw new AppError(400, "INVALID_MEMBERSHIP_STATUS", "会员测试状态不正确");
    }
    return repository.setDevelopmentMembership(
      current.context,
      body.active,
      new Date()
    );
  });

  app.get<{
    Querystring: { signature?: string; timestamp?: string; nonce?: string; echostr?: string };
  }>("/wechat/xpay-callback", async (request, reply) => {
    const { signature = "", timestamp = "", nonce = "", echostr = "" } = request.query;
    if (!verifyWechatMessageSignature(config.wechatMessageToken, timestamp, nonce, signature)) {
      throw new AppError(403, "INVALID_WECHAT_SIGNATURE", "微信消息签名无效");
    }
    return reply.type("text/plain").send(echostr);
  });

  app.post<{
    Querystring: { signature?: string; timestamp?: string; nonce?: string };
  }>("/wechat/xpay-callback", async (request, reply) => {
    const { signature = "", timestamp = "", nonce = "" } = request.query;
    if (!verifyWechatMessageSignature(config.wechatMessageToken, timestamp, nonce, signature)) {
      throw new AppError(403, "INVALID_WECHAT_SIGNATURE", "微信消息签名无效");
    }
    const xml = typeof request.body === "string";
    try {
      const event = parseGoodsDeliveryNotification(request.body);
      await repository.fulfillMembershipPaymentOrder({
        outTradeNo: event.outTradeNo,
        openId: event.openId,
        productId: event.productId,
        amountFen: event.actualPrice,
        env: event.env,
        transactionId: event.transactionId,
        paidAt: event.paidAt
      });
      return xml
        ? reply.type("application/xml").send("<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>")
        : reply.send({ ErrCode: 0, ErrMsg: "success" });
    } catch (error) {
      request.log.error({ err: error }, "virtual payment delivery failed");
      return xml
        ? reply.type("application/xml").send("<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[delivery failed]]></ErrMsg></xml>")
        : reply.send({ ErrCode: 1, ErrMsg: "delivery failed" });
    }
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

  app.get("/onboarding", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const [membership, profile, assessment, completedAssessments, assessmentCount] = await Promise.all([
      repository.getMembershipStatus(current.context),
      repository.getLearnerProfile(current.context),
      repository.getLatestInitialAssessment(current.context),
      repository.listCompletedAssessments(current.context, 10),
      repository.countCompletedAssessments(current.context)
    ]);
    const difficulty = assessment?.difficulty ||
      assessmentDifficultyForExperience(profile.englishExperience);
    return {
      membership,
      profile,
      assessment: membership.active ? assessment : null,
      assessmentHistory: membership.active
        ? completedAssessments.map((item) => ({
            id: item.id,
            difficulty: item.difficulty,
            level: item.level,
            scores: item.scores,
            summary: item.summary,
            completedAt: item.completedAt
          }))
        : [],
      assessmentCount: membership.active ? assessmentCount : 0,
      questionCount: assessmentQuestions(difficulty).length,
      difficulty,
      profileOptions: {
        ageBands: AGE_BANDS,
        gradeLevels: GRADE_LEVELS,
        englishExperiences: ENGLISH_EXPERIENCES,
        learningGoals: LEARNING_GOALS
      }
    };
  });

  app.put("/onboarding/profile", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    await requireMembership(repository, current.context);
    const body = bodyRecord(request);
    const learningGoals = Array.isArray(body.learningGoals)
      ? body.learningGoals.filter((goal): goal is string => typeof goal === "string")
      : [];
    const profileInput = {
      ageBand: optionalText(body, "ageBand", 20),
      gradeLevel: optionalText(body, "gradeLevel", 30),
      englishExperience: optionalText(body, "englishExperience", 30),
      learningGoals
    };
    validateLearnerProfile(profileInput);
    return repository.updateLearnerProfile(current.context, {
      ageBand: profileInput.ageBand,
      gradeLevel: profileInput.gradeLevel,
      englishExperience: profileInput.englishExperience,
      learningGoals: profileInput.learningGoals
    });
  });

  app.post("/assessments/initial/start", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    await requireMembership(repository, current.context);
    const profile = await repository.getLearnerProfile(current.context);
    if (!assessmentProfileComplete(profile)) {
      throw new AppError(409, "LEARNER_PROFILE_REQUIRED", "请先完成学习者基本信息");
    }
    const latest = await repository.getLatestInitialAssessment(current.context);
    const inProgress = latest?.status === "IN_PROGRESS" ? latest : null;
    const difficulty = inProgress?.difficulty ||
      assessmentDifficultyForExperience(profile.englishExperience);
    const assessment = inProgress || await repository.createInitialAssessment(
      current.context,
      difficulty
    );
    return reply.status(inProgress ? 200 : 201).send({
      assessment,
      questions: assessmentQuestions(assessment.difficulty)
    });
  });

  app.post<{ Params: { id: string } }>(
    "/assessments/initial/:id/answers",
    async (request) => {
      const current = await auth.authenticate(request.headers.authorization);
      await requireMembership(repository, current.context);
      const body = bodyRecord(request);
      const questionKey = requiredText(body, "questionKey", 80);
      const currentAssessment = await repository.getLatestInitialAssessment(current.context);
      if (
        !currentAssessment ||
        currentAssessment.id !== request.params.id ||
        currentAssessment.status !== "IN_PROGRESS"
      ) {
        throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
      }
      const question = assessmentQuestion(questionKey, currentAssessment.difficulty);
      const skipped = body.skipped === true;
      let answer: InitialAssessmentAnswer;
      if (skipped) {
        answer = {
          questionKey,
          dimension: question.dimension,
          result: "SKIPPED",
          answerText: null,
          recognizedText: null,
          score: null,
          pronunciationScore: null,
          accuracyScore: null,
          fluencyScore: null,
          completenessScore: null
        };
      } else {
        const answerText = requiredText(body, "answerText", 200);
        const result = assessTextAnswer(question, answerText);
        answer = {
          questionKey,
          dimension: question.dimension,
          result: result.correct ? "CORRECT" : "INCORRECT",
          answerText,
          recognizedText: null,
          score: result.score,
          pronunciationScore: null,
          accuracyScore: null,
          fluencyScore: null,
          completenessScore: null
        };
      }
      const updatedAssessment = await repository.saveInitialAssessmentAnswer(
        current.context,
        request.params.id,
        answer
      );
      return {
        answeredCount: updatedAssessment.answers.length,
        result: answer.result,
        score: answer.score
      };
    }
  );

  app.post<{ Params: { id: string; questionKey: string } }>(
    "/assessments/initial/:id/questions/:questionKey/voice",
    async (request, reply) => {
      const current = await auth.authenticate(request.headers.authorization);
      await requireMembership(repository, current.context);
      const currentAssessment = await repository.getLatestInitialAssessment(current.context);
      if (
        !currentAssessment ||
        currentAssessment.id !== request.params.id ||
        currentAssessment.status !== "IN_PROGRESS"
      ) {
        throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
      }
      const referenceText = assessmentReferenceText(
        request.params.questionKey,
        currentAssessment.difficulty
      );
      const question = assessmentQuestion(
        request.params.questionKey,
        currentAssessment.difficulty
      );
      const upload = await request.file();
      if (!upload) throw new AppError(400, "AUDIO_REQUIRED", "请上传录音");
      const audio = await upload.toBuffer();
      const voice = await (options.voiceResolver || assessVoiceAnswer)(
        audio,
        upload.mimetype,
        config,
        referenceText
      );
      const recognizedCorrect = normalizeEnglish(voice.recognizedText) === normalizeEnglish(referenceText);
      const correct = recognizedCorrect && voice.pronunciationScore >= 60;
      const updatedAssessment = await repository.saveInitialAssessmentAnswer(
        current.context,
        request.params.id,
        {
          questionKey: request.params.questionKey,
          dimension: question.dimension,
          result: correct ? "CORRECT" : "INCORRECT",
          answerText: null,
          recognizedText: voice.recognizedText,
          score: voice.pronunciationScore,
          pronunciationScore: voice.pronunciationScore,
          accuracyScore: voice.accuracyScore,
          fluencyScore: voice.fluencyScore,
          completenessScore: voice.completenessScore
        }
      );
      return reply.status(201).send({
        answeredCount: updatedAssessment.answers.length,
        correct,
        voice
      });
    }
  );

  app.post<{ Params: { id: string } }>(
    "/assessments/initial/:id/complete",
    async (request) => {
      const current = await auth.authenticate(request.headers.authorization);
      await requireMembership(repository, current.context);
      const [assessment, profile] = await Promise.all([
        repository.getLatestInitialAssessment(current.context),
        repository.getLearnerProfile(current.context)
      ]);
      if (!assessment || assessment.id !== request.params.id || assessment.status !== "IN_PROGRESS") {
        throw new AppError(404, "INITIAL_ASSESSMENT_NOT_FOUND", "未找到进行中的能力测评");
      }
      if (assessment.answers.length !== assessmentQuestions(assessment.difficulty).length) {
        throw new AppError(409, "ASSESSMENT_INCOMPLETE", "还有测评题目未完成");
      }
      const result = calculateAssessmentResult(
        assessment.answers,
        profile.learningGoals,
        assessment.difficulty
      );
      return repository.completeInitialAssessment(
        current.context,
        assessment.id,
        result,
        new Date()
      );
    }
  );

  app.delete("/assessments/initial/dev-reset", async (request) => {
    if (config.nodeEnv === "production" || !config.devLoginEnabled) {
      throw new AppError(404, "NOT_FOUND", "接口不存在");
    }
    const current = await auth.authenticate(request.headers.authorization);
    await repository.resetInitialAssessment(current.context);
    return { reset: true };
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

  app.put("/me/goals", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    const body = bodyRecord(request);
    const dailyScoreGoal = Number(body.dailyScoreGoal);
    const weeklyGoalDays = Number(body.weeklyGoalDays);
    if (!Number.isInteger(dailyScoreGoal) || dailyScoreGoal < 1 || dailyScoreGoal > 999) {
      throw new AppError(400, "INVALID_DAILY_SCORE_GOAL", "每日达标分数必须是 1-999 的整数");
    }
    if (!Number.isInteger(weeklyGoalDays) || weeklyGoalDays < 1 || weeklyGoalDays > 7) {
      throw new AppError(400, "INVALID_WEEKLY_GOAL_DAYS", "每周达标天数必须是 1-7 的整数");
    }
    return repository.updateLearningGoals(current.context, {
      dailyScoreGoal,
      weeklyGoalDays
    });
  });

  app.post("/check-ins/today", async (request, reply) => {
    const current = await auth.authenticate(request.headers.authorization);
    const result = await repository.checkInToday(current.context);
    return reply.status(result.firstCheckInToday ? 201 : 200).send(result);
  });

  app.get("/daily-plans/today", async (request) => {
    const current = await auth.authenticate(request.headers.authorization);
    return repository.getTodayDailyPlan(current.context);
  });

  app.get<{ Params: { id: string; taskKey: string } }>(
    "/daily-plans/:id/tasks/:taskKey/words",
    async (request) => {
      const current = await auth.authenticate(request.headers.authorization);
      const taskKey = request.params.taskKey as DailyPlanTaskKey;
      if (!["REVIEW", "NEW_WORDS", "OUTPUT"].includes(taskKey)) {
        throw new AppError(400, "INVALID_DAILY_TASK", "今日学习任务不正确");
      }
      return {
        words: await repository.getDailyPlanTaskWords(
          current.context,
          request.params.id,
          taskKey
        )
      };
    }
  );

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
    return { name: `启蒙 ${words.length} 词`, count: words.length, words };
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
    await requireMembership(repository, current.context);
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
    await requireMembership(repository, current.context);
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
    await requireMembership(repository, current.context);
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
            : "已浏览",
      dailyPlanId: optionalText(body, "dailyPlanId", 128) || undefined,
      dailyTaskKey:
        (optionalText(body, "dailyTaskKey", 40) as DailyPlanTaskKey) || undefined
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
      mode: "WORD_PRONUNCIATION",
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
    const query = request.query as {
      mode?: string;
      limit?: string;
      scope?: string;
      dailyPlanId?: string;
      dailyTaskKey?: string;
    };
    if (!query.mode || !choiceModes.has(query.mode as ChoiceQuestion["mode"])) {
      throw new AppError(400, "INVALID_MODE", "练习模式不正确");
    }
    const scope = query.scope === "weak" ? "weak" : "all";
    const limit = Math.min(20, Math.max(1, Number(query.limit) || 10));
    const dailyTaskKey = query.dailyTaskKey as DailyPlanTaskKey | undefined;
    const planWords =
      query.dailyPlanId && dailyTaskKey
        ? await repository.getDailyPlanTaskWords(
            current.context,
            query.dailyPlanId,
            dailyTaskKey
          )
        : [];
    return {
      questions: await repository.getChoiceQuestions(
        current.context,
        query.mode as ChoiceQuestion["mode"],
        limit,
        scope,
        planWords.length ? planWords.map((word) => word.id) : undefined
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
      answerText: optionalText(body, "answerText", 120) || undefined,
      dailyPlanId: optionalText(body, "dailyPlanId", 128) || undefined,
      dailyTaskKey:
        (optionalText(body, "dailyTaskKey", 40) as DailyPlanTaskKey) || undefined
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
    const targetWord = (await repository.listWords(current.context)).find(
      (word) => normalizeEnglish(word.english) === normalizeEnglish(prompt.targetWord)
    );
    await repository.recordAttempt(current.context, {
      vocabularyItemId: targetWord?.id,
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
    const targetWord = (await repository.listWords(current.context)).find(
      (word) => normalizeEnglish(word.english) === normalizeEnglish(prompt.targetWord)
    );
    await repository.recordAttempt(current.context, {
      vocabularyItemId: targetWord?.id,
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
