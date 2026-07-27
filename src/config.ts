export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigin: string;
  devLoginEnabled: boolean;
  sessionTtlDays: number;
  wechatAppId: string;
  wechatAppSecret: string;
  azureTtsEndpoint: string;
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechVoice: string;
  aiEvaluationProvider: "auto" | "rules" | "openai" | "zhipu";
  openAiApiKey: string;
  openAiBaseUrl: string;
  openAiModel: string;
  zhipuApiKey: string;
  zhipuBaseUrl: string;
  zhipuTextModel: string;
  zhipuPlatformApiKey: string;
  zhipuPlatformBaseUrl: string;
  zhipuVisionModel: string;
  zhipuImageModel: string;
  avatarStoragePath: string;
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadConfig(): AppConfig {
  const requestedEvaluator = process.env.AI_EVALUATION_PROVIDER;
  const aiEvaluationProvider =
    requestedEvaluator === "openai" ||
    requestedEvaluator === "zhipu" ||
    requestedEvaluator === "rules"
      ? requestedEvaluator
      : "auto";

  return {
    nodeEnv: process.env.NODE_ENV || "development",
    host: process.env.HOST || "0.0.0.0",
    port: positiveNumber(process.env.PORT, 3000),
    corsOrigin: process.env.CORS_ORIGIN || "*",
    devLoginEnabled: process.env.DEV_LOGIN_ENABLED !== "false",
    sessionTtlDays: positiveNumber(process.env.SESSION_TTL_DAYS, 30),
    wechatAppId: process.env.WECHAT_APP_ID || "",
    wechatAppSecret: process.env.WECHAT_APP_SECRET || "",
    azureTtsEndpoint: process.env.AZURE_TTS_ENDPOINT || "",
    azureSpeechKey: process.env.AZURE_TTS_KEY || "",
    azureSpeechRegion: process.env.AZURE_TTS_REGION || "",
    azureSpeechVoice: process.env.AZURE_SPEECH_VOICE || "en-US-JennyNeural",
    aiEvaluationProvider,
    openAiApiKey: process.env.OPENAI_API_KEY || "",
    openAiBaseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    openAiModel: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    zhipuApiKey: process.env.ZHIPU_API_KEY || "",
    zhipuBaseUrl:
      process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/coding/paas/v4",
    zhipuTextModel: process.env.ZHIPU_TEXT_MODEL || "glm-5.2",
    zhipuPlatformApiKey: process.env.ZHIPU_PLATFORM_API_KEY || "",
    zhipuPlatformBaseUrl:
      process.env.ZHIPU_PLATFORM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    zhipuVisionModel: process.env.ZHIPU_VISION_MODEL || "glm-4.6v-flash",
    zhipuImageModel: process.env.ZHIPU_IMAGE_MODEL || "glm-image",
    avatarStoragePath: process.env.AVATAR_STORAGE_PATH || "storage/avatars"
  };
}
