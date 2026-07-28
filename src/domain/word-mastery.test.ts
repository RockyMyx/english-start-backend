import { describe, expect, it } from "vitest";
import { buildWordMastery } from "./word-mastery.js";

describe("buildWordMastery", () => {
  it("maps correct practice modes to the five capability steps", () => {
    const mastery = buildWordMastery([
      "WORD_READING",
      "LISTEN_CHOOSE_MEANING",
      "DICTATION",
      "WORD_PRONUNCIATION",
      "SENTENCE"
    ]);

    expect(mastery.completedCount).toBe(5);
    expect(mastery.levelName).toBe("会用");
    expect(mastery.steps.every((step) => step.completed)).toBe(true);
  });

  it("keeps independent steps visible when practice is not sequential", () => {
    const mastery = buildWordMastery(["DICTATION"]);

    expect(mastery.completedCount).toBe(1);
    expect(mastery.levelName).toBe("拼写");
    expect(mastery.steps.map((step) => step.completed)).toEqual([
      false,
      false,
      true,
      false,
      false
    ]);
  });
});
