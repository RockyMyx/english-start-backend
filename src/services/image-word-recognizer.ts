import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";

export interface RecognizedWord {
  english: string;
  chinese: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: string };
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) =>
      item && typeof item === "object" && "text" in item
        ? String((item as { text?: unknown }).text || "")
        : ""
    )
    .join("");
}

function parseJsonPayload(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = (fenced ? fenced[1] : content).trim();
  try {
    return JSON.parse(source);
  } catch {
    const objectStart = source.indexOf("{");
    const objectEnd = source.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(source.slice(objectStart, objectEnd + 1));
    }
    throw new AppError(502, "INVALID_VISION_RESPONSE", "图片识别结果格式不正确，请重新拍摄");
  }
}

function sanitizeWords(payload: unknown): RecognizedWord[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && "words" in payload
      ? (payload as { words?: unknown }).words
      : [];
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const words: RecognizedWord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const english =
      typeof (row as { english?: unknown }).english === "string"
        ? (row as { english: string }).english.trim().slice(0, 80)
        : "";
    const chinese =
      typeof (row as { chinese?: unknown }).chinese === "string"
        ? (row as { chinese: string }).chinese.trim().slice(0, 120)
        : "";
    const key = english.toLowerCase().replace(/\s+/g, " ");
    if (!english || !/[a-z]/i.test(english) || seen.has(key)) continue;
    seen.add(key);
    words.push({ english, chinese });
    if (words.length >= 50) break;
  }
  return words;
}

export async function recognizeWordsFromImage(
  image: Buffer,
  contentType: string,
  config: AppConfig
): Promise<RecognizedWord[]> {
  const apiKey = config.zhipuPlatformApiKey || config.zhipuApiKey;
  if (!apiKey) {
    throw new AppError(503, "VISION_NOT_CONFIGURED", "图片识别服务尚未配置");
  }
  const imageUrl = `data:${contentType};base64,${image.toString("base64")}`;
  let lastMessage = "图片识别服务暂时不可用";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      `${config.zhipuPlatformBaseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: config.zhipuVisionModel,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: imageUrl }
                },
                {
                  type: "text",
                  text:
                    "识别图片中清晰可见、适合英语初学者学习的英文单词或常用短语，并给出简短准确的中文释义。只提取图片里真实出现的英文，不要猜测或补充。若没有英文，返回空数组。严格只返回 JSON：{\"words\":[{\"english\":\"apple\",\"chinese\":\"苹果\"}]}。最多 50 项。"
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      }
    );
    const payload = (await response.json()) as CompletionResponse;
    if (response.ok) {
      const content = contentText(payload.choices?.[0]?.message?.content);
      return sanitizeWords(parseJsonPayload(content));
    }
    lastMessage = payload.error?.message || lastMessage;
    const retryable =
      response.status === 429 ||
      /访问量|繁忙|稍后再试|rate limit/i.test(lastMessage);
    if (!retryable || attempt === 2) break;
    // 视觉服务偶发拥堵时短暂退避，避免让用户重新拍照。
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new AppError(502, "VISION_PROVIDER_ERROR", lastMessage);
}
