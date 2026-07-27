import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config.js";
import { synthesizeSpeech } from "./speech-service.js";

const config: AppConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 3000,
  corsOrigin: "*",
  devLoginEnabled: true,
  sessionTtlDays: 30,
  wechatAppId: "",
  wechatAppSecret: "",
  azureTtsEndpoint: "https://eastasia.api.cognitive.microsoft.com/",
  azureSpeechKey: "azure-test-key",
  azureSpeechRegion: "eastasia",
  azureSpeechVoice: "en-US-JennyNeural",
  aiEvaluationProvider: "rules",
  openAiApiKey: "",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiModel: "gpt-test",
  zhipuApiKey: "",
  zhipuBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
  zhipuTextModel: "glm-5.2",
  zhipuPlatformApiKey: "",
  zhipuPlatformBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
  zhipuVisionModel: "glm-vision-test",
  zhipuImageModel: "glm-image-test"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speech provider routing", () => {
  it("uses Youdao for words", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("word-audio"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeSpeech("hello", 0.85, config, "word");

    expect(result.provider).toBe("youdao");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://dict.youdao.com/dictvoice?audio=hello&type=2"
    );
  });

  it("uses Azure for sentences", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(Buffer.from("sentence-audio"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await synthesizeSpeech("How old are you?", 0.85, config, "sentence");
    const second = await synthesizeSpeech("How old are you?", 0.85, config, "sentence");

    expect(first).toMatchObject({ provider: "azure", cacheStatus: "MISS" });
    expect(second).toMatchObject({ provider: "azure", cacheStatus: "HIT" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1"
    );
  });
});
