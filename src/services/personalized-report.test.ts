import { describe, expect, it } from "vitest";
import type { PracticeMode } from "../domain/types.js";
import {
  buildPersonalizedLearningReport,
  type ReportAttemptSnapshot
} from "./personalized-report.js";

function attempt(input: Partial<ReportAttemptSnapshot> & {
  mode: PracticeMode;
  occurredAt: string;
}): ReportAttemptSnapshot {
  return {
    mode: input.mode,
    result: input.result || "CORRECT",
    occurredAt: new Date(input.occurredAt),
    vocabularyItemId: input.vocabularyItemId || null,
    vocabularyEnglish: input.vocabularyEnglish || null,
    answerText: input.answerText || null,
    recognizedText: input.recognizedText || null,
    promptText: input.promptText || null,
    referenceAnswer: input.referenceAnswer || null,
    semanticScore: input.semanticScore ?? null,
    pronunciationScore: input.pronunciationScore ?? null
  };
}

describe("personalized learning report", () => {
  it("builds four capability layers from concrete weekly evidence", () => {
    const report = buildPersonalizedLearningReport({
      generatedDate: "2026-08-05",
      learningGoals: ["SPELLING", "SPEAKING"],
      weakWords: [
        {
          id: "weak-1",
          english: "where",
          chinese: "哪里",
          phonetic: null,
          attemptCount: 3,
          correctCount: 1,
          incorrectCount: 2,
          accuracy: 33
        }
      ],
      attempts: [
        attempt({
          mode: "WORD_CHOOSE_MEANING",
          occurredAt: "2026-07-30T04:00:00.000Z",
          vocabularyItemId: "apple",
          vocabularyEnglish: "apple"
        }),
        attempt({
          mode: "MEANING_CHOOSE_WORD",
          occurredAt: "2026-08-01T04:00:00.000Z",
          vocabularyItemId: "apple",
          vocabularyEnglish: "apple"
        }),
        attempt({
          mode: "DICTATION",
          occurredAt: "2026-08-02T04:00:00.000Z",
          vocabularyItemId: "book",
          vocabularyEnglish: "book",
          answerText: "book",
          promptText: "book"
        }),
        attempt({
          mode: "DICTATION",
          occurredAt: "2026-08-03T04:00:00.000Z",
          vocabularyItemId: "book",
          vocabularyEnglish: "book",
          answerText: "book",
          promptText: "book"
        }),
        attempt({
          mode: "WORD_PRONUNCIATION",
          occurredAt: "2026-08-04T04:00:00.000Z",
          vocabularyItemId: "yellow",
          vocabularyEnglish: "yellow",
          recognizedText: "yellow",
          pronunciationScore: 76
        }),
        attempt({
          mode: "SENTENCE",
          occurredAt: "2026-08-04T05:00:00.000Z",
          recognizedText: "My book is blue.",
          semanticScore: 90
        }),
        attempt({
          mode: "DICTATION",
          result: "INCORRECT",
          occurredAt: "2026-08-05T04:00:00.000Z",
          vocabularyItemId: "what",
          vocabularyEnglish: "what",
          answerText: "waht",
          promptText: "what"
        })
      ]
    });

    expect(report.capabilities).toHaveLength(4);
    expect(report.capabilities.map((item) => item.performance)).toEqual(
      expect.arrayContaining([
        "稳定认读 1 个词",
        "能独立拼写 1 个词",
        "1 个词达到通过标准",
        "本周完成 1 个有效表达"
      ])
    );
    expect(report.evidence).toMatchObject({
      newlyMasteredWords: expect.arrayContaining(["apple", "book"]),
      expressions: ["My book is blue."],
      pronunciationHighlights: ["yellow"],
      confusions: ["waht／what"]
    });
    expect(report.nextStep).toContain("where");
  });
});
