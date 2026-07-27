import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { evaluateSemanticAnswer } from "./semantic-evaluator.js";

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
  aiEvaluationProvider: "zhipu",
  openAiApiKey: "",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiModel: "gpt-test",
  zhipuApiKey: "test-key",
  zhipuBaseUrl: "https://example.test/api/coding/paas/v4",
  zhipuTextModel: "glm-5.2",
  zhipuPlatformApiKey: "",
  zhipuPlatformBaseUrl: "https://example.test/api/paas/v4",
  zhipuVisionModel: "glm-vision-test",
  zhipuImageModel: "glm-image-test",
  avatarStoragePath: "storage/test-avatars"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Zhipu semantic evaluator", () => {
  it("uses a chat completions response and validates its JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"correct":true,"score":96,"feedback":"意思正确","improvedAnswer":"I am eight."}'
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await evaluateSemanticAnswer(
      {
        question: "How old are you?",
        evaluationHint: "回答年龄",
        referenceAnswer: "I am eight.",
        acceptedAnswers: ["I'm eight."],
        answer: "Eight.",
        userId: "user-1"
      },
      config
    );

    expect(result).toMatchObject({ correct: true, score: 96, provider: "zhipu" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.test/api/coding/paas/v4/chat/completions"
    );
  });
});
