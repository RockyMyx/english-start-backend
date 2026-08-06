import { describe, expect, it } from "vitest";
import type { InitialAssessmentAnswer } from "../domain/types.js";
import {
  assessmentQuestion,
  assessmentDifficultyForExperience,
  assessmentQuestions,
  assessTextAnswer,
  calculateAssessmentResult
} from "./initial-assessment.js";

function answer(
  dimension: InitialAssessmentAnswer["dimension"],
  score: number | null,
  result: InitialAssessmentAnswer["result"] = "CORRECT"
): InitialAssessmentAnswer {
  return {
    questionKey: `${dimension}-${score}-${result}`,
    dimension,
    result,
    answerText: null,
    recognizedText: null,
    score,
    pronunciationScore: dimension === "PRONUNCIATION" ? score : null,
    accuracyScore: null,
    fluencyScore: null,
    completenessScore: null
  };
}

describe("initial assessment", () => {
  it("selects different stable question sets from English experience", () => {
    expect(assessmentDifficultyForExperience("NONE")).toBe("FOUNDATION");
    expect(assessmentDifficultyForExperience("UNDER_6_MONTHS")).toBe("FOUNDATION");
    expect(assessmentDifficultyForExperience("6_TO_12_MONTHS")).toBe("STANDARD");
    expect(assessmentDifficultyForExperience("OVER_1_YEAR")).toBe("ADVANCED");
    expect(assessmentQuestions("FOUNDATION")).toHaveLength(12);
    expect(assessmentQuestions("STANDARD")).toHaveLength(16);
    expect(assessmentQuestions("ADVANCED")).toHaveLength(16);
  });

  it("accepts known answers without exposing free-form AI judgment", () => {
    expect(assessmentQuestion("recognition-apple")).toMatchObject({
      type: "TEXT",
      prompt: "apple"
    });
    expect(assessTextAnswer(assessmentQuestion("recognition-apple"), "苹果")).toMatchObject({
      correct: true,
      score: 100
    });
    expect(assessmentQuestion("spelling-cat")).toMatchObject({
      type: "TEXT",
      prompt: "猫"
    });
    expect(assessTextAnswer(assessmentQuestion("spelling-cat"), "cat")).toMatchObject({
      correct: true,
      score: 100
    });
    expect(assessTextAnswer(assessmentQuestion("expression-blue-book"), "My book is blue.")).toMatchObject({
      correct: true,
      score: 100
    });
  });

  it("keeps skipped pronunciation unscored and respects multiple goals", () => {
    const result = calculateAssessmentResult(
      [
        answer("RECOGNITION", 100),
        answer("SPELLING", 100),
        answer("PRONUNCIATION", null, "SKIPPED"),
        answer("EXPRESSION", 0, "INCORRECT")
      ],
      ["VOCABULARY", "SPEAKING"]
    );
    expect(result).toMatchObject({
      level: "词汇运用",
      scores: {
        recognition: 100,
        spelling: 100,
        pronunciation: null,
        expression: 0
      }
    });
    expect(result.summary).toContain("表达");
  });

  it("calibrates the overall stage against the assigned question difficulty", () => {
    const halfCorrect = [
      answer("RECOGNITION", 100),
      answer("RECOGNITION", 0, "INCORRECT"),
      answer("SPELLING", 100),
      answer("SPELLING", 0, "INCORRECT"),
      answer("EXPRESSION", 100),
      answer("EXPRESSION", 0, "INCORRECT")
    ];
    expect(calculateAssessmentResult(halfCorrect, ["BALANCED"], "FOUNDATION").level)
      .toBe("启蒙起步");
    expect(calculateAssessmentResult(halfCorrect, ["BALANCED"], "ADVANCED").level)
      .toBe("初步表达");
  });
});
