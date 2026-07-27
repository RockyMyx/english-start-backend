import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";

export type SpeechKind = "auto" | "word" | "sentence";
type SpeechProvider = "youdao" | "azure";
type SpeechCacheStatus = "HIT" | "MISS";

interface SpeechResult {
  audio: Buffer;
  contentType: string;
  provider: SpeechProvider;
  cacheStatus: SpeechCacheStatus;
}

const MAX_SPEECH_CACHE_ITEMS = 200;
const speechCache = new Map<string, Omit<SpeechResult, "cacheStatus">>();

function readSpeechCache(key: string): SpeechResult | null {
  const cached = speechCache.get(key);
  if (!cached) return null;
  speechCache.delete(key);
  speechCache.set(key, cached);
  return { ...cached, cacheStatus: "HIT" };
}

function writeSpeechCache(key: string, result: Omit<SpeechResult, "cacheStatus">): SpeechResult {
  speechCache.set(key, result);
  while (speechCache.size > MAX_SPEECH_CACHE_ITEMS) {
    const oldestKey = speechCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    speechCache.delete(oldestKey);
  }
  return { ...result, cacheStatus: "MISS" };
}

function azureTtsUrl(config: AppConfig): string {
  let endpoint: URL;
  try {
    endpoint = new URL(config.azureTtsEndpoint);
  } catch {
    throw new AppError(503, "SPEECH_NOT_CONFIGURED", "Azure TTS Endpoint 格式不正确");
  }
  if (endpoint.protocol !== "https:") {
    throw new AppError(503, "SPEECH_NOT_CONFIGURED", "Azure TTS Endpoint 必须使用 HTTPS");
  }
  if (endpoint.hostname.endsWith(".tts.speech.microsoft.com")) {
    return endpoint.pathname === "/" || !endpoint.pathname
      ? `${endpoint.origin}/cognitiveservices/v1`
      : endpoint.toString();
  }
  if (endpoint.hostname.endsWith(".api.cognitive.microsoft.com")) {
    return `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }
  throw new AppError(503, "SPEECH_NOT_CONFIGURED", "Azure TTS Endpoint 不是受支持的语音地址");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function synthesizeSpeech(
  text: string,
  speed: number,
  config: AppConfig,
  kind: SpeechKind = "auto"
): Promise<SpeechResult> {
  const useAzure = kind === "sentence" || (kind === "auto" && /\s/.test(text.trim()));
  const provider: SpeechProvider = useAzure ? "azure" : "youdao";
  const cacheKey = JSON.stringify({
    provider,
    text: text.trim(),
    speed,
    voice: useAzure ? config.azureSpeechVoice : "",
    endpoint: useAzure ? config.azureTtsEndpoint : ""
  });
  const cached = readSpeechCache(cacheKey);
  if (cached) return cached;

  if (useAzure) {
    if (!config.azureTtsEndpoint || !config.azureSpeechKey || !config.azureSpeechRegion) {
      throw new AppError(503, "SPEECH_NOT_CONFIGURED", "微软语音服务尚未配置");
    }
    const rate = `${Math.round((speed - 1) * 100)}%`;
    const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${escapeXml(config.azureSpeechVoice)}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`;
    const response = await fetch(
      azureTtsUrl(config),
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.azureSpeechKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3"
        },
        body: ssml
      }
    );
    if (!response.ok) {
      throw new AppError(502, "SPEECH_PROVIDER_FAILED", "微软语音生成失败");
    }
    return writeSpeechCache(cacheKey, {
      audio: Buffer.from(await response.arrayBuffer()),
      contentType: "audio/mpeg",
      provider: "azure"
    });
  }

  const response = await fetch(
    `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`
  );
  if (!response.ok) {
    throw new AppError(502, "SPEECH_PROVIDER_FAILED", "单词发音获取失败");
  }
  return writeSpeechCache(cacheKey, {
    audio: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "audio/mpeg",
    provider: "youdao"
  });
}
