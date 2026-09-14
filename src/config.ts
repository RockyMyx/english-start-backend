export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigin: string;
  devLoginEnabled: boolean;
  sessionTtlDays: number;
  wechatAppId: string;
  wechatAppSecret: string;
  wechatMessageToken: string;
  wechatVirtualPaymentOfferId: string;
  wechatVirtualPaymentAppKey: string;
  wechatVirtualPaymentProductId: string;
  wechatVirtualPaymentEnv: 0 | 1;
  membershipPriceFen: number;
  membershipDurationDays: number;
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

function positiveInteger(value: string | undefined, fallback: number): number {
  return Math.floor(positiveNumber(value, fallback));
}

function membershipPaymentConfig(): Pick<AppConfig, "membershipPriceFen" | "wechatVirtualPaymentProductId"> {
  const mode = process.env.MEMBERSHIP_PAYMENT_MODE?.trim() || "";
  if (!mode) {
    return {
      membershipPriceFen: positiveInteger(process.env.MEMBERSHIP_PRICE_FEN, 9900),
      wechatVirtualPaymentProductId: process.env.WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID || ""
    };
  }
  if (mode !== "test" && mode !== "live") {
    throw new Error("MEMBERSHIP_PAYMENT_MODE 必须为 test 或 live");
  }

  // 显式模式不读取旧配置，避免测试价残留导致正式环境误收低价。
  const prefix = `MEMBERSHIP_${mode.toUpperCase()}`;
  const priceValue = process.env[`${prefix}_PRICE_FEN`]?.trim();
  const priceFen = priceValue ? Number(priceValue) : mode === "test" ? 100 : 9900;
  if (!Number.isSafeInteger(priceFen) || priceFen <= 0) {
    throw new Error(`${prefix}_PRICE_FEN 必须是正整数，单位为分`);
  }
  return {
    membershipPriceFen: priceFen,
    wechatVirtualPaymentProductId: process.env[`${prefix}_PRODUCT_ID`]?.trim()
      || (mode === "test" ? "membership_year_test" : "membership_year")
  };
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
    wechatMessageToken: process.env.WECHAT_MESSAGE_TOKEN || "",
    wechatVirtualPaymentOfferId: process.env.WECHAT_VIRTUAL_PAYMENT_OFFER_ID || "",
    wechatVirtualPaymentAppKey: process.env.WECHAT_VIRTUAL_PAYMENT_APP_KEY || "",
    wechatVirtualPaymentEnv: process.env.WECHAT_VIRTUAL_PAYMENT_ENV === "1" ? 1 : 0,
    ...membershipPaymentConfig(),
    membershipDurationDays: positiveInteger(process.env.MEMBERSHIP_DURATION_DAYS, 365),
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
