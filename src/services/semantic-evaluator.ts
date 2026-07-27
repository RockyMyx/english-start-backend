import { createHash } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { SemanticEvaluation } from "../domain/types.js";
import { AppError } from "../lib/errors.js";

interface EvaluationInput {
  question: string;
  evaluationHint: string;
  referenceAnswer: string;
  acceptedAnswers: string[];
  answer: string;
  userId: string;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, "")
    .replace(/\s+/g, " ");
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function rulesEvaluation(input: EvaluationInput): SemanticEvaluation {
  const answer = normalize(input.answer);
  if (!answer) {
    return {
      correct: false,
      score: 0,
      feedback: "请先输入你的回答",
      improvedAnswer: input.referenceAnswer,
      provider: "rules"
    };
  }
  const accepted = input.acceptedAnswers.map(normalize);
  if (accepted.includes(answer)) {
    return {
      correct: true,
      score: 100,
      feedback: "意思表达正确",
      improvedAnswer: input.referenceAnswer,
      provider: "rules"
    };
  }

  const hint = input.evaluationHint;
  const numberAnswer = /\b(?:[1-9]|10|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(
    answer
  );
  const nameAnswer = /^(?:my name is|i am|im|i'm)\s+[a-z]+(?:\s+[a-z]+)?$/.test(answer);
  const colorAnswer = /\b(?:red|yellow|green|blue|black|white|pink)\b/.test(answer);
  const yesNoAnswer = /^(?:yes|no)\b/.test(answer);
  const feelingAnswer = /\b(?:happy|sad|fine|good|great|okay|ok)\b/.test(answer);

  const flexibleMatch =
    (hint.includes("名字") && nameAnswer) ||
    (hint.includes("年龄") && numberAnswer) ||
    (hint.includes("颜色") && colorAnswer) ||
    (hint.includes("肯定或否定") && yesNoAnswer) ||
    (hint.includes("状态") && feelingAnswer);
  if (flexibleMatch) {
    return {
      correct: true,
      score: 90,
      feedback: "回答符合对话意思",
      improvedAnswer: input.referenceAnswer,
      provider: "rules"
    };
  }

  const similarity = Math.max(
    tokenSimilarity(answer, input.referenceAnswer),
    ...input.acceptedAnswers.map((candidate) => tokenSimilarity(answer, candidate))
  );
  const correct = similarity >= 0.6;
  return {
    correct,
    score: Math.round(similarity * 100),
    feedback: correct ? "意思基本正确，可以再注意完整表达" : "意思还不够准确，请参考示例回答",
    improvedAnswer: input.referenceAnswer,
    provider: "rules"
  };
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return "";
}

function parseEvaluation(
  text: string,
  provider: SemanticEvaluation["provider"]
): SemanticEvaluation {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  let result: {
    correct?: unknown;
    score?: unknown;
    feedback?: unknown;
    improvedAnswer?: unknown;
  };
  try {
    result = JSON.parse(cleaned) as typeof result;
  } catch {
    throw new AppError(502, "AI_EVALUATION_INVALID", "AI 评审结果格式不正确");
  }
  if (
    typeof result.correct !== "boolean" ||
    typeof result.score !== "number" ||
    typeof result.feedback !== "string" ||
    typeof result.improvedAnswer !== "string"
  ) {
    throw new AppError(502, "AI_EVALUATION_INVALID", "AI 评审结果格式不正确");
  }
  return {
    correct: result.correct,
    score: Math.min(100, Math.max(0, Math.round(result.score))),
    feedback: result.feedback.slice(0, 200),
    improvedAnswer: result.improvedAnswer.slice(0, 200),
    provider
  };
}

const evaluationInstruction =
  "You evaluate a beginner's English answer. Judge semantic appropriateness, not exact wording. " +
  "Minor grammar mistakes are acceptable when the intended meaning is clear. " +
  "Return only compact JSON with keys correct(boolean), score(number 0-100), feedback(Chinese), improvedAnswer(English).";

function evaluationPayload(input: EvaluationInput) {
  return {
    question: input.question,
    evaluationHint: input.evaluationHint,
    referenceAnswer: input.referenceAnswer,
    acceptedAnswers: input.acceptedAnswers,
    learnerAnswer: input.answer
  };
}

async function openAiEvaluation(
  input: EvaluationInput,
  config: AppConfig
): Promise<SemanticEvaluation> {
  const response = await fetch(`${config.openAiBaseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.openAiModel,
      store: false,
      reasoning: { effort: "low" },
      safety_identifier: createHash("sha256").update(input.userId).digest("hex"),
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: evaluationInstruction
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(evaluationPayload(input))
            }
          ]
        }
      ]
    }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new AppError(502, "AI_EVALUATION_FAILED", "AI 评审服务暂时不可用");
  }
  return parseEvaluation(extractResponseText(await response.json()), "openai");
}

async function zhipuEvaluation(
  input: EvaluationInput,
  config: AppConfig
): Promise<SemanticEvaluation> {
  const response = await fetch(
    `${config.zhipuBaseUrl.replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.zhipuApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.zhipuTextModel,
        temperature: 0.1,
        max_tokens: 400,
        thinking: { type: "disabled" },
        messages: [
          { role: "system", content: evaluationInstruction },
          { role: "user", content: JSON.stringify(evaluationPayload(input)) }
        ]
      }),
      signal: AbortSignal.timeout(15_000)
    }
  );
  if (!response.ok) {
    throw new AppError(502, "AI_EVALUATION_FAILED", "AI 评审服务暂时不可用");
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AppError(502, "AI_EVALUATION_INVALID", "AI 评审结果格式不正确");
  }
  return parseEvaluation(content, "zhipu");
}

export async function evaluateSemanticAnswer(
  input: EvaluationInput,
  config: AppConfig
): Promise<SemanticEvaluation> {
  const provider = config.aiEvaluationProvider;
  const resolvedProvider =
    provider === "auto"
      ? config.zhipuApiKey
        ? "zhipu"
        : config.openAiApiKey
          ? "openai"
          : "rules"
      : provider;
  if (resolvedProvider === "rules") return rulesEvaluation(input);
  const apiKey =
    resolvedProvider === "zhipu" ? config.zhipuApiKey : config.openAiApiKey;
  if (!apiKey) throw new AppError(503, "AI_NOT_CONFIGURED", "尚未配置 AI 评审密钥");
  try {
    return resolvedProvider === "zhipu"
      ? await zhipuEvaluation(input, config)
      : await openAiEvaluation(input, config);
  } catch (error) {
    if (provider !== "auto") throw error;
    return rulesEvaluation(input);
  }
}
