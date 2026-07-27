import type { AppConfig } from "../config.js";
import type { VoiceEvaluation } from "../domain/types.js";
import { AppError } from "../lib/errors.js";

interface AzureRecognition {
  RecognitionStatus?: string;
  DisplayText?: string;
  NBest?: Array<{
    Display?: string;
    Lexical?: string;
    PronScore?: number;
    AccuracyScore?: number;
    FluencyScore?: number;
    CompletenessScore?: number;
  }>;
}

function azureEndpoint(region: string): string {
  return `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
}

async function recognize(
  audio: Buffer,
  contentType: string,
  config: AppConfig,
  referenceText?: string
): Promise<AzureRecognition> {
  const headers: Record<string, string> = {
    "Ocp-Apim-Subscription-Key": config.azureSpeechKey,
    "Content-Type": contentType,
    Accept: "application/json"
  };
  if (referenceText) {
    headers["Pronunciation-Assessment"] = Buffer.from(
      JSON.stringify({
        ReferenceText: referenceText,
        GradingSystem: "HundredMark",
        Granularity: "Word",
        Dimension: "Comprehensive",
        EnableMiscue: true,
        EnableProsodyAssessment: true
      })
    ).toString("base64");
  }
  const response = await fetch(azureEndpoint(config.azureSpeechRegion), {
    method: "POST",
    headers,
    body: Uint8Array.from(audio).buffer,
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    throw new AppError(502, "SPEECH_ASSESSMENT_FAILED", "语音识别或发音评测失败");
  }
  return (await response.json()) as AzureRecognition;
}

export async function assessVoiceAnswer(
  audio: Buffer,
  contentType: string,
  config: AppConfig
): Promise<VoiceEvaluation> {
  if (!config.azureSpeechKey || !config.azureSpeechRegion) {
    throw new AppError(
      503,
      "SPEECH_ASSESSMENT_NOT_CONFIGURED",
      "语音评测尚未配置，请先使用文字回答"
    );
  }
  if (
    contentType !== "audio/wav" &&
    contentType !== "audio/x-wav" &&
    contentType !== "audio/ogg" &&
    !contentType.startsWith("audio/wav;") &&
    !contentType.startsWith("audio/ogg;")
  ) {
    throw new AppError(415, "UNSUPPORTED_AUDIO_FORMAT", "录音必须使用 WAV 或 OGG 格式");
  }

  const transcription = await recognize(audio, contentType, config);
  const recognizedText =
    transcription.NBest?.[0]?.Display ||
    transcription.NBest?.[0]?.Lexical ||
    transcription.DisplayText ||
    "";
  if (!recognizedText || transcription.RecognitionStatus === "NoMatch") {
    throw new AppError(422, "SPEECH_NOT_RECOGNIZED", "没有识别到清晰的英文，请重新录音");
  }

  const assessment = await recognize(audio, contentType, config, recognizedText);
  const score = assessment.NBest?.[0];
  return {
    recognizedText,
    pronunciationScore: score?.PronScore || 0,
    accuracyScore: score?.AccuracyScore || 0,
    fluencyScore: score?.FluencyScore || 0,
    completenessScore: score?.CompletenessScore || 0
  };
}
