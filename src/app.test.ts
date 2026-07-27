import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "./config.js";
import { buildApp } from "./app.js";
import { MemoryAppRepository } from "./repositories/memory-repository.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3000,
  corsOrigin: "*",
  devLoginEnabled: true,
  sessionTtlDays: 30,
  wechatAppId: "",
  wechatAppSecret: "",
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
  zhipuImageModel: "glm-image"
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

describe("English Start API", () => {
  it("creates an empty single-user account and allows direct word entry", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      wordCount: 0,
      todayScore: 0,
      dailyScoreGoal: 50,
      modules: { choice: false, dictation: false, sentence: false, dialogue: false }
    });

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

  it("stores a custom daily score goal for the current user", async () => {
    const app = await buildApp({ repository: new MemoryAppRepository(), config });
    apps.push(app);
    const token = await login(app);
    const headers = { authorization: `Bearer ${token}` };

    const updated = await app.inject({
      method: "PUT",
      url: "/me/daily-goal",
      headers,
      payload: { dailyScoreGoal: 80 }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ dailyScoreGoal: 80 });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({ dailyScoreGoal: 80 });
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
    expect(previewBody).toMatchObject({ name: "启蒙 50 词", count: 50 });
    expect(previewBody.words.some((word) => word.english === "old")).toBe(false);
    expect(previewBody.words.map((word) => word.english)).toEqual(
      expect.arrayContaining(["what", "how old", "I", "apple", "banana"])
    );

    const first = await app.inject({
      method: "POST",
      url: "/starter-pack/import",
      headers
    });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ imported: 50, total: 50 });

    const second = await app.inject({
      method: "POST",
      url: "/starter-pack/import",
      headers
    });
    expect(second.json()).toMatchObject({ imported: 0, total: 50 });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({
      wordCount: 50,
      modules: { choice: true, dictation: true, sentence: true, dialogue: true }
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
    expect(cleared.json()).toEqual({ removed: 50 });

    const words = await app.inject({ method: "GET", url: "/words", headers });
    expect(words.json()).toEqual({ words: [] });

    const me = await app.inject({ method: "GET", url: "/me", headers });
    expect(me.json()).toMatchObject({
      wordCount: 0,
      modules: { choice: false, dictation: false, sentence: false, dialogue: false }
    });

    const preview = await app.inject({ method: "GET", url: "/starter-pack", headers });
    expect(preview.json()).toMatchObject({ name: "启蒙 50 词", count: 50 });
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
