import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { buildApp } from "./app.js";
import { sha256 } from "./lib/crypto.js";
import { MemoryAppRepository } from "./repositories/memory-repository.js";
import { redemptionCodeHash } from "./services/membership-service.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3000,
  corsOrigin: "*",
  devLoginEnabled: true,
  sessionTtlDays: 30,
  wechatAppId: "wx-test-app",
  wechatAppSecret: "test-app-secret",
  wechatMessageToken: "test-message-token",
  wechatVirtualPaymentOfferId: "test-offer",
  wechatVirtualPaymentAppKey: "test-app-key",
  wechatVirtualPaymentProductId: "membership-year",
  wechatVirtualPaymentEnv: 1,
  membershipPriceFen: 9900,
  membershipDurationDays: 365,
  azureTtsEndpoint: "",
  azureSpeechKey: "",
  azureSpeechRegion: "",
  azureSpeechVoice: "en-US-JennyNeural",
  aiEvaluationProvider: "rules",
  openAiApiKey: "",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiModel: "gpt-5.6-luna",
  zhipuApiKey: "",
  zhipuBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  zhipuTextModel: "glm-5.2",
  zhipuPlatformApiKey: "",
  zhipuPlatformBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  zhipuVisionModel: "glm-4.6v-flash",
  zhipuImageModel: "glm-image",
  avatarStoragePath: "storage/test-avatars"
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function login(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/dev-login",
    payload: { openId: "learner-001" }
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ token: string }>().token;
}

async function redeemMembership(
  app: Awaited<ReturnType<typeof buildApp>>,
  repository: MemoryAppRepository,
  headers: { authorization: string },
  code = "ES7D-TEST-TEST-0001"
) {
  await repository.createMembershipRedemptionCode({
    codeHash: redemptionCodeHash(code),
    codeHint: code.slice(-4),
    durationDays: 7
  });
  const redeemed = await app.inject({
    method: "POST",
    url: "/membership/redeem",
    headers,
    payload: { code }
  });
  expect(redeemed.statusCode).toBe(200);
  expect(redeemed.json()).toMatchObject({ active: true });
  return redeemed;
}

describe("English Start API", () => {
  it("serves the membership product image", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/media/membership-product.png"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.rawPayload.length).toBeGreaterThan(0);
  });

  it("keeps direct word entry for members only", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({ repository, config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      wordCount: 0,
      todayScore: 0,
      dailyScoreGoal: 50,
      weeklyGoalDays: 5,
      weekCompletedDays: 0,
      modules: { choice: false, dictation: false, sentence: false, dialogue: false }
    });

    const denied = await app.inject({
      method: "POST",
      url: "/words",
      headers,
      payload: { english: "apple", chinese: "苹果" }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ error: "MEMBERSHIP_REQUIRED" });

    await redeemMembership(app, repository, headers);
    const added = await app.inject({
      method: "POST",
      url: "/words",
      headers,
      payload: { english: "apple", chinese: "苹果" }
    });
    expect(added.statusCode).toBe(201);

    const after = await app.inject({ method: "GET", url: "/me", headers });
    expect(after.json()).toMatchObject({
      wordCount: 1,
      modules: { dictation: true }
    });
  });

  it("stores daily and weekly learning goals for the current user", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const updated = await app.inject({
      method: "PUT",
      url: "/me/goals",
      headers,
      payload: { dailyScoreGoal: 80, weeklyGoalDays: 6 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ dailyScoreGoal: 80, weeklyGoalDays: 6 });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({ dailyScoreGoal: 80, weeklyGoalDays: 6 });

    const invalid = await app.inject({
      method: "PUT",
      url: "/me/goals",
      headers,
      payload: { dailyScoreGoal: 80, weeklyGoalDays: 8 }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: "INVALID_WEEKLY_GOAL_DAYS" });
  });

  it("recognizes photographed words before batch importing them", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({
      repository,
      config,
      imageWordResolver: async () => [
        { english: "apple", chinese: "苹果" },
        { english: "blue", chinese: "蓝色" }
      ]
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await redeemMembership(app, repository, headers, "ES7D-TEST-TEST-0002");
    const boundary = "----english-start-photo";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="words.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
      ),
      Buffer.from("test-image"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const recognized = await app.inject({
      method: "POST",
      url: "/words/recognize-image",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(recognized.statusCode).toBe(200);
    expect(recognized.json()).toMatchObject({
      recognized: 2,
      words: [
        { english: "apple", chinese: "苹果" },
        { english: "blue", chinese: "蓝色" }
      ]
    });

    const imported = await app.inject({
      method: "POST",
      url: "/words/batch",
      headers,
      payload: { words: recognized.json<{ words: unknown[] }>().words }
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json()).toMatchObject({ saved: 2 });

    const words = await app.inject({ method: "GET", url: "/words", headers });
    expect(words.json<{ words: Array<{ english: string }> }>().words.map((word) => word.english))
      .toEqual(expect.arrayContaining(["apple", "blue"]));
  });

  it("imports the starter pack idempotently and unlocks all current modules", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const preview = await app.inject({ method: "GET", url: "/starter-pack", headers });
    const previewBody = preview.json<{
      name: string;
      count: number;
      words: Array<{ english: string }>;
    }>();
    expect(previewBody).toMatchObject({ name: "启蒙 70 词", count: 70 });
    expect(previewBody.words.some((word) => word.english === "old")).toBe(false);
    const starterEnglishWords = previewBody.words.map((word) => word.english);
    expect(starterEnglishWords).toEqual(
      expect.arrayContaining([
        "what",
        "how old",
        "I",
        "apple",
        "banana",
        "table",
        "yes",
        "he",
        "a",
        "an",
        "like",
        "there"
      ])
    );
    expect(
      starterEnglishWords.filter((word) =>
        [
        "happy",
        "sad",
        "mother",
        "father",
        "sister",
        "brother",
        "desk",
        "pink"
        ].includes(word)
      )
    ).toEqual([]);

    const first = await app.inject({
      method: "POST",
      url: "/starter-pack/import",
      headers
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ imported: 70, total: 70 });

    const second = await app.inject({
      method: "POST",
      url: "/starter-pack/import",
      headers
    });
    expect(second.json()).toMatchObject({ imported: 0, total: 70 });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({
      wordCount: 70,
      modules: { choice: true, dictation: true, sentence: true, dialogue: true }
    });
  });

  it("redeems each code once and stacks membership time", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({ repository, config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const first = await redeemMembership(app, repository, headers, "ES7D-TEST-STACK-001");
    const firstExpiry = new Date(first.json<{ expiresAt: string }>().expiresAt);
    const repeated = await app.inject({
      method: "POST",
      url: "/membership/redeem",
      headers,
      payload: { code: "ES7D-TEST-STACK-001" }
    });
    expect(repeated.statusCode).toBe(400);
    expect(repeated.json()).toMatchObject({ error: "INVALID_REDEMPTION_CODE" });

    const second = await redeemMembership(app, repository, headers, "ES7D-TEST-STACK-002");
    const secondExpiry = new Date(second.json<{ expiresAt: string }>().expiresAt);
    expect(secondExpiry.getTime() - firstExpiry.getTime()).toBe(7 * 86_400_000);
  });

  it("creates and confirms a virtual-payment membership order", async () => {
    const repository = new MemoryAppRepository();
    let queryCount = 0;
    const app = await buildApp({
      repository,
      config,
      wechatResolver: async () => ({
        openId: "dev:learner-001",
        sessionKey: "test-session-key"
      }),
      virtualPaymentQueryResolver: async () => {
        queryCount += 1;
        return {
          status: 2,
          paidFee: 9900,
          paidAt: new Date("2026-09-06T04:00:00.000Z"),
          transactionId: "wx-transaction-1"
        };
      }
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const created = await app.inject({
      method: "POST",
      url: "/membership/payment/orders",
      headers,
      payload: { code: "fresh-wechat-code" }
    });
    expect(created.statusCode).toBe(201);
    const payment = created.json<{
      payment: { outTradeNo: string; signData: string; paySig: string; signature: string };
    }>().payment;
    expect(JSON.parse(payment.signData)).toMatchObject({
      productId: "membership-year",
      goodsPrice: 9900,
      outTradeNo: payment.outTradeNo
    });
    expect(payment.paySig).toHaveLength(64);
    expect(payment.signature).toHaveLength(64);

    const confirmed = await app.inject({
      method: "POST",
      url: `/membership/payment/orders/${payment.outTradeNo}/confirm`,
      headers
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      status: "DELIVERED",
      membership: { active: true }
    });

    const repeated = await app.inject({
      method: "POST",
      url: `/membership/payment/orders/${payment.outTradeNo}/confirm`,
      headers
    });
    expect(repeated.json()).toMatchObject({ status: "DELIVERED" });
    expect(queryCount).toBe(1);
  });

  it("delivers membership once from a signed virtual-payment callback", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({
      repository,
      config,
      wechatResolver: async () => ({
        openId: "dev:learner-001",
        sessionKey: "test-session-key"
      })
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    const created = await app.inject({
      method: "POST",
      url: "/membership/payment/orders",
      headers,
      payload: { code: "fresh-wechat-code" }
    });
    const outTradeNo = created.json<{ payment: { outTradeNo: string } }>().payment.outTradeNo;
    const timestamp = "1788681600";
    const nonce = "callback-nonce";
    const signature = createHash("sha1")
      .update([config.wechatMessageToken, timestamp, nonce].sort().join(""))
      .digest("hex");
    const callbackUrl = `/wechat/xpay-callback?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`;
    const payload = {
      Event: "xpay_goods_deliver_notify",
      OpenId: "dev:learner-001",
      OutTradeNo: outTradeNo,
      Env: 1,
      WeChatPayInfo: { TransactionId: "wx-transaction-2", PaidTime: 1788681600 },
      GoodsInfo: { ProductId: "membership-year", Quantity: 1, ActualPrice: 9900 }
    };

    const delivered = await app.inject({ method: "POST", url: callbackUrl, payload });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.json()).toEqual({ ErrCode: 0, ErrMsg: "success" });
    const firstMembership = await repository.getMembershipStatus({ userId: (await repository.ensureIdentity("dev:learner-001")).userId });
    expect(firstMembership.active).toBe(true);

    const repeated = await app.inject({ method: "POST", url: callbackUrl, payload });
    expect(repeated.json()).toEqual({ ErrCode: 0, ErrMsg: "success" });
    const secondMembership = await repository.getMembershipStatus({ userId: (await repository.ensureIdentity("dev:learner-001")).userId });
    expect(secondMembership.expiresAt).toEqual(firstMembership.expiresAt);
  });

  it("switches the current user between member and free states in debug mode", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({ repository, config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const enabled = await app.inject({
      method: "PUT",
      url: "/membership/dev-status",
      headers,
      payload: { active: true }
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({ active: true });

    const disabled = await app.inject({
      method: "PUT",
      url: "/membership/dev-status",
      headers,
      payload: { active: false }
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ active: false, expiresAt: null });
  });

  it("does not expose the debug membership switch in production", async () => {
    const repository = new MemoryAppRepository();
    const context = await repository.ensureIdentity("production-membership-test");
    const token = "production-test-token";
    await repository.createSession({
      userId: context.userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60_000)
    });
    const app = await buildApp({
      repository,
      config: { ...config, nodeEnv: "production" }
    });
    apps.push(app);

    const response = await app.inject({
      method: "PUT",
      url: "/membership/dev-status",
      headers: { authorization: `Bearer ${token}` },
      payload: { active: true }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "NOT_FOUND" });
  });

  it("collects multiple learning goals and completes an isolated initial assessment", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({
      repository,
      config,
      voiceResolver: async (_audio, _contentType, _config, referenceText) => ({
        recognizedText: referenceText || "",
        pronunciationScore: 82,
        accuracyScore: 84,
        fluencyScore: 80,
        completenessScore: 100
      })
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const denied = await app.inject({
      method: "POST",
      url: "/assessments/initial/start",
      headers
    });
    expect(denied.statusCode).toBe(403);

    await app.inject({
      method: "PUT",
      url: "/membership/dev-status",
      headers,
      payload: { active: true }
    });
    const savedProfile = await app.inject({
      method: "PUT",
      url: "/onboarding/profile",
      headers,
      payload: {
        ageBand: "6-7",
        gradeLevel: "GRADE_1",
        englishExperience: "UNDER_6_MONTHS",
        learningGoals: ["VOCABULARY", "SPEAKING"]
      }
    });
    expect(savedProfile.statusCode).toBe(200);
    expect(savedProfile.json()).toMatchObject({
      complete: true,
      learningGoals: ["VOCABULARY", "SPEAKING"]
    });

    const started = await app.inject({
      method: "POST",
      url: "/assessments/initial/start",
      headers
    });
    expect(started.statusCode).toBe(201);
    const startedBody = started.json<{
      assessment: { id: string };
      questions: Array<{
        key: string;
        type: "CHOICE" | "TEXT" | "VOICE";
        prompt: string;
        options: Array<{ id: string }>;
      }>;
    }>();
    expect(startedBody.questions).toHaveLength(12);
    expect(started.json()).toMatchObject({
      assessment: { difficulty: "FOUNDATION" }
    });

    let voiceAnswered = false;
    const skippedQuestionTypes = new Set<string>();
    for (const question of startedBody.questions) {
      if (!skippedQuestionTypes.has(question.type)) {
        const skippedResponse = await app.inject({
          method: "POST",
          url: `/assessments/initial/${startedBody.assessment.id}/answers`,
          headers,
          payload: { questionKey: question.key, skipped: true }
        });
        expect(skippedResponse.statusCode).toBe(200);
        expect(skippedResponse.json()).toMatchObject({
          result: "SKIPPED",
          score: null
        });
        skippedQuestionTypes.add(question.type);
        continue;
      }
      if (question.type === "VOICE" && !voiceAnswered) {
        const boundary = "----english-start-assessment-voice";
        const payload = Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer.wav"\r\nContent-Type: audio/wav\r\n\r\n`
          ),
          Buffer.from("test-audio"),
          Buffer.from(`\r\n--${boundary}--\r\n`)
        ]);
        const voiceResponse = await app.inject({
          method: "POST",
          url: `/assessments/initial/${startedBody.assessment.id}/questions/${question.key}/voice`,
          headers: {
            ...headers,
            "content-type": `multipart/form-data; boundary=${boundary}`
          },
          payload
        });
        expect(voiceResponse.statusCode).toBe(201);
        voiceAnswered = true;
        continue;
      }
      const response = await app.inject({
        method: "POST",
        url: `/assessments/initial/${startedBody.assessment.id}/answers`,
        headers,
        payload: question.type === "VOICE"
          ? { questionKey: question.key, skipped: true }
          : {
              questionKey: question.key,
              answerText: question.type === "CHOICE"
                ? question.options[0].id
                : question.prompt
            }
      });
      expect(response.statusCode).toBe(200);
    }
    expect(skippedQuestionTypes).toEqual(new Set(["TEXT", "CHOICE", "VOICE"]));

    const completed = await app.inject({
      method: "POST",
      url: `/assessments/initial/${startedBody.assessment.id}/complete`,
      headers
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "COMPLETED",
      scores: { pronunciation: 82 }
    });

    const afterCompletion = await app.inject({
      method: "GET",
      url: "/onboarding",
      headers
    });
    expect(afterCompletion.json()).toMatchObject({
      assessmentCount: 1,
      assessmentHistory: [
        {
          id: startedBody.assessment.id,
          level: expect.any(String),
          scores: { pronunciation: 82 }
        }
      ]
    });

    const repeated = await app.inject({
      method: "POST",
      url: "/assessments/initial/start",
      headers
    });
    expect(repeated.statusCode).toBe(201);
    expect(repeated.json()).toMatchObject({
      assessment: { status: "IN_PROGRESS", difficulty: "FOUNDATION" }
    });
    expect(repeated.json<{ assessment: { id: string } }>().assessment.id)
      .not.toBe(startedBody.assessment.id);

    const report = await app.inject({ method: "GET", url: "/reports/learning", headers });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      totalAttempts: 0,
      personalizedLocked: false,
      personalized: {
        baseline: {
          level: expect.any(String),
          scores: { pronunciation: 82 }
        },
        capabilities: expect.any(Array),
        evidence: expect.any(Object),
        nextStep: expect.any(String)
      }
    });
  });

  it("starts with a harder question set for experienced learners", async () => {
    const repository = new MemoryAppRepository();
    const app = await buildApp({ repository, config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({
      method: "PUT",
      url: "/membership/dev-status",
      headers,
      payload: { active: true }
    });
    await app.inject({
      method: "PUT",
      url: "/onboarding/profile",
      headers,
      payload: {
        ageBand: "10-12",
        gradeLevel: "GRADE_5",
        englishExperience: "OVER_1_YEAR",
        learningGoals: ["SCHOOL", "SPEAKING"]
      }
    });
    const started = await app.inject({
      method: "POST",
      url: "/assessments/initial/start",
      headers
    });
    expect(started.statusCode).toBe(201);
    const body = started.json<{
      assessment: { difficulty: string };
      questions: Array<{ key: string }>;
    }>();
    expect(body.assessment.difficulty).toBe("ADVANCED");
    expect(body.questions).toHaveLength(16);
    expect(body.questions.map((question) => question.key)).toEqual(
      expect.arrayContaining([
        "recognition-how-many",
        "spelling-pencil",
        "expression-yellow-pencil"
      ])
    );
    expect(body.questions.map((question) => question.key)).not.toContain("recognition-apple");

    await app.inject({
      method: "PUT",
      url: "/onboarding/profile",
      headers,
      payload: {
        ageBand: "10-12",
        gradeLevel: "GRADE_5",
        englishExperience: "NONE",
        learningGoals: ["SCHOOL", "SPEAKING"]
      }
    });
    const resumed = await app.inject({
      method: "POST",
      url: "/assessments/initial/start",
      headers
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      assessment: { id: expect.any(String), difficulty: "ADVANCED" },
      questions: expect.arrayContaining([
        expect.objectContaining({ key: "expression-yellow-pencil" })
      ])
    });
  });

  it("keeps the basic report visible while locking personalization for free users", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const report = await app.inject({
      method: "GET",
      url: "/reports/learning",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      totalAttempts: 0,
      personalizedLocked: true,
      personalized: null
    });
    const onboarding = await app.inject({
      method: "GET",
      url: "/onboarding",
      headers: { authorization: `Bearer ${token}` }
    });
    expect(onboarding.json()).toMatchObject({
      membership: { active: false },
      assessment: null
    });
  });

  it("clears only the current word library and keeps shared starter content", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const cleared = await app.inject({ method: "DELETE", url: "/words", headers });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ removed: 70 });

    const words = await app.inject({ method: "GET", url: "/words", headers });
    expect(words.json()).toEqual({ words: [] });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({
      wordCount: 0,
      modules: { choice: false, dictation: false, sentence: false, dialogue: false }
    });

    const preview = await app.inject({ method: "GET", url: "/starter-pack", headers });
    expect(preview.json()).toMatchObject({ name: "启蒙 70 词", count: 70 });
  });

  it("generates choice questions and records answers", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const questions = await app.inject({
      method: "GET",
      url: "/practice/questions?mode=WORD_CHOOSE_MEANING&limit=4",
      headers
    });
    expect(questions.statusCode).toBe(200);
    const question = questions.json<{ questions: Array<{ wordId: string }> }>().questions[0];

    const answer = await app.inject({
      method: "POST",
      url: "/practice/answers",
      headers,
      payload: {
        mode: "WORD_CHOOSE_MEANING",
        wordId: question.wordId,
        selectedWordId: question.wordId
      }
    });
    expect(answer.statusCode).toBe(201);
    expect(answer.json()).toMatchObject({
      correct: true,
      correctWordId: question.wordId
    });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({ todayPracticeCount: 1, todayScore: 1 });
  });

  it("evaluates sentence and open dialogue text answers", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const sentence = await app.inject({ method: "GET", url: "/sentences", headers });
    const sentencePrompt = sentence.json<{
      prompts: Array<{ id: string; promptChinese: string; targetWord?: string; referenceAnswer?: string }>;
    }>().prompts[0];
    expect(sentencePrompt.targetWord).toBeUndefined();
    expect(sentencePrompt.referenceAnswer).toBeUndefined();
    const sentenceId = sentencePrompt.id;
    const sentenceAnswer = await app.inject({
      method: "POST",
      url: `/sentences/${sentenceId}/answer`,
      headers,
      payload: { answer: "I am eight." }
    });
    expect(sentenceAnswer.json()).toMatchObject({ correct: true, provider: "rules" });

    const dialogues = await app.inject({ method: "GET", url: "/dialogues", headers });
    const dialogueId = dialogues.json<{ prompts: Array<{ id: string }> }>().prompts[0].id;
    const dialogueAnswer = await app.inject({
      method: "POST",
      url: `/dialogues/${dialogueId}/text-answer`,
      headers,
      payload: { answer: "I'm eight." }
    });
    expect(dialogueAnswer.json()).toMatchObject({ correct: true });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({ todayPracticeCount: 2, todayScore: 7 });
  });

  it("accepts WAV sentence and dialogue answers with semantic and pronunciation results", async () => {
    let voiceCalls = 0;
    const app = await buildApp({
      repository: new MemoryAppRepository(),
      config,
      voiceResolver: async () => ({
        recognizedText: voiceCalls++ === 0 ? "I am eight." : "I'm eight.",
        pronunciationScore: 88,
        accuracyScore: 90,
        fluencyScore: 85,
        completenessScore: 100
      })
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const boundary = "----english-start-test";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      ),
      Buffer.from("RIFF-test-audio"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const sentences = await app.inject({ method: "GET", url: "/sentences", headers });
    const sentenceId = sentences.json<{ prompts: Array<{ id: string }> }>().prompts[0].id;
    const sentenceResult = await app.inject({
      method: "POST",
      url: `/sentences/${sentenceId}/voice-answer`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(sentenceResult.statusCode).toBe(201);
    expect(sentenceResult.json()).toMatchObject({
      correct: true,
      voice: { recognizedText: "I am eight.", pronunciationScore: 88 }
    });

    const dialogues = await app.inject({ method: "GET", url: "/dialogues", headers });
    const dialogueId = dialogues.json<{ prompts: Array<{ id: string }> }>().prompts[0].id;
    const result = await app.inject({
      method: "POST",
      url: `/dialogues/${dialogueId}/voice-answer`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toMatchObject({
      correct: true,
      voice: { recognizedText: "I'm eight.", pronunciationScore: 88 }
    });
  });

  it("checks in idempotently and builds a learning report with weak words", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });
    const words = await app.inject({ method: "GET", url: "/words", headers });
    const wordRows = words.json<{ words: Array<{ id: string; english: string }> }>().words;
    const word = wordRows[0];

    const tooEarlyCheckIn = await app.inject({
      method: "POST",
      url: "/check-ins/today",
      headers
    });
    expect(tooEarlyCheckIn.statusCode).toBe(409);
    expect(tooEarlyCheckIn.json()).toMatchObject({ error: "LEARNING_REQUIRED" });

    for (const [index, currentWord] of wordRows.slice(0, 3).entries()) {
      const reading = await app.inject({
        method: "POST",
        url: `/words/${currentWord.id}/reading`,
        headers,
        payload: { result: index === 0 ? "INCORRECT" : "CORRECT" }
      });
      expect(reading.statusCode).toBe(201);
    }

    const dashboardAfterPractice = await app.inject({
      method: "GET",
      url: "/me",
      headers
    });
    expect(dashboardAfterPractice.statusCode).toBe(200);
    expect(dashboardAfterPractice.json()).toMatchObject({
      checkedInToday: true,
      checkInDays: 1,
      currentStreak: 1,
      weekCompletedDays: 1,
      weeklyGoalDays: 5
    });

    const firstCheckIn = await app.inject({
      method: "POST",
      url: "/check-ins/today",
      headers
    });
    expect(firstCheckIn.statusCode).toBe(200);
    expect(firstCheckIn.json()).toMatchObject({
      checkedInToday: true,
      firstCheckInToday: false,
      totalDays: 1,
      totalStudyDays: 1,
      currentStreak: 1,
      weekCompletedDays: 1,
      weeklyGoalDays: 5
    });

    const repeatedCheckIn = await app.inject({
      method: "POST",
      url: "/check-ins/today",
      headers
    });
    expect(repeatedCheckIn.statusCode).toBe(200);
    expect(repeatedCheckIn.json()).toMatchObject({
      firstCheckInToday: false,
      totalDays: 1
    });

    const report = await app.inject({ method: "GET", url: "/reports/learning", headers });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      wordCount: 70,
      totalCheckInDays: 1,
      currentStreak: 1,
      totalAttempts: 3,
      correctAttempts: 2,
      weakWords: [
        {
          id: word.id,
          english: word.english,
          incorrectCount: 1,
          accuracy: 0
        }
      ]
    });

    const weakQuestions = await app.inject({
      method: "GET",
      url: "/practice/questions?mode=WORD_CHOOSE_MEANING&scope=weak&limit=10",
      headers
    });
    expect(weakQuestions.statusCode).toBe(200);
    expect(
      weakQuestions.json<{ questions: Array<{ wordId: string }> }>().questions
    ).toEqual([]);
  });

  it("uses the vocabulary word as the pronunciation reference", async () => {
    let referenceText = "";
    const app = await buildApp({
      repository: new MemoryAppRepository(),
      config,
      voiceResolver: async (_audio, _contentType, _config, reference) => {
        referenceText = reference || "";
        return {
          recognizedText: referenceText,
          pronunciationScore: 86.5,
          accuracyScore: 88,
          fluencyScore: 82,
          completenessScore: 100
        };
      }
    });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });
    const words = await app.inject({ method: "GET", url: "/words", headers });
    const word = words.json<{ words: Array<{ id: string; english: string }> }>().words[0];

    const boundary = "----english-start-word-reading";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="word.wav"\r\nContent-Type: audio/wav\r\n\r\n`
      ),
      Buffer.from("RIFF-test-word-audio"),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const result = await app.inject({
      method: "POST",
      url: `/words/${word.id}/pronunciation`,
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(result.statusCode).toBe(201);
    expect(referenceText).toBe(word.english);
    expect(result.json()).toMatchObject({
      correct: true,
      recognizedCorrect: true,
      voice: { pronunciationScore: 86.5 }
    });
  });

  it("stores the learner profile and groups pending review items", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const profile = await app.inject({
      method: "PUT",
      url: "/profile",
      headers,
      payload: { nickname: "小洛", englishName: "Rocky" }
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      nickname: "小洛",
      englishName: "Rocky",
      avatarPath: null
    });

    const questions = await app.inject({
      method: "GET",
      url: "/practice/questions?mode=WORD_CHOOSE_MEANING&limit=1",
      headers
    });
    const question = questions.json<{
      questions: Array<{ wordId: string; options: Array<{ id: string }> }>;
    }>().questions[0];
    const wrongOption = question.options.find((option) => option.id !== question.wordId);
    await app.inject({
      method: "POST",
      url: "/practice/answers",
      headers,
      payload: {
        mode: "WORD_CHOOSE_MEANING",
        wordId: question.wordId,
        selectedWordId: wrongOption?.id
      }
    });

    const review = await app.inject({ method: "GET", url: "/review", headers });
    const pending = review.json<{
      pendingCount: number;
      items: Array<{ type: string; key: string; status: string }>;
    }>();
    expect(pending.pendingCount).toBe(0);
    expect(review.json()).toMatchObject({ upcomingCount: 1 });

    await app.inject({
      method: "PUT",
      url: "/review/status",
      headers,
      payload: {
        itemType: "WORD",
        itemKey: `word:${question.wordId}`,
        status: "MASTERED"
      }
    });
    const mastered = await app.inject({ method: "GET", url: "/review", headers });
    expect(mastered.json()).toMatchObject({ pendingCount: 0, masteredCount: 1 });
  });

  it("keeps the same daily plan and exposes its selected words", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/starter-pack/import", headers });

    const first = await app.inject({ method: "GET", url: "/daily-plans/today", headers });
    const second = await app.inject({ method: "GET", url: "/daily-plans/today", headers });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
      const plan = first.json<{
        id: string;
        totalCount: number;
        nextTaskKey: string;
        tasks: Array<{ key: string; mode: string; targetCount: number }>;
      }>();
    expect(second.json()).toMatchObject({ id: plan.id, tasks: plan.tasks });
    expect(plan.totalCount).toBeGreaterThan(0);

    const words = await app.inject({
      method: "GET",
      url: `/daily-plans/${plan.id}/tasks/${plan.nextTaskKey}/words`,
      headers
    });
      expect(words.statusCode).toBe(200);
      expect(words.json<{ words: unknown[] }>().words.length).toBeGreaterThan(0);

      const allWords = (
        await app.inject({ method: "GET", url: "/words", headers })
      ).json<{ words: Array<{ id: string }> }>().words;
      const selectedIds = new Set(
        words.json<{ words: Array<{ id: string }> }>().words.map((word) => word.id)
      );
      const unrelatedWord = allWords.find((word) => !selectedIds.has(word.id));
      expect(unrelatedWord).toBeDefined();
      const rejectedAttempt = await app.inject({
        method: "POST",
        url: `/words/${unrelatedWord!.id}/reading`,
        headers,
        payload: {
          result: "CORRECT",
          dailyPlanId: plan.id,
          dailyTaskKey: plan.nextTaskKey
        }
      });
      expect(rejectedAttempt.statusCode).toBe(400);
      expect(rejectedAttempt.json()).toMatchObject({
        error: "INVALID_DAILY_TASK_ATTEMPT"
      });
    });

  it("accepts a WeChat avatar uploaded with a generic content type", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };
    const boundary = "----english-start-wechat-avatar";
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="avatar"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const result = await app.inject({
      method: "POST",
      url: "/profile/avatar",
      headers: {
        ...headers,
        "content-type": `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    expect(result.statusCode).toBe(201);
    const profile = result.json<{ avatarPath: string }>();
    expect(profile.avatarPath).toMatch(/^\/media\/avatars\/[a-f0-9-]+\.png$/);

    const avatar = await app.inject({ method: "GET", url: profile.avatarPath });
    expect(avatar.statusCode).toBe(200);
    expect(avatar.headers["content-type"]).toContain("image/png");

    await rm(
      path.resolve(config.avatarStoragePath, path.basename(profile.avatarPath)),
      { force: true }
    );
  });

  it("keeps malformed client requests as 4xx responses", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const result = await app.inject({
      method: "POST",
      url: "/auth/dev-login",
      headers: { "content-type": "application/json" },
      payload: "{not-json"
    });
    expect(result.statusCode).toBe(400);
    expect(result.json()).toMatchObject({ error: "FST_ERR_CTP_INVALID_JSON_BODY" });
  });
});
