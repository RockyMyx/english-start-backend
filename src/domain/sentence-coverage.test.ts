import { describe, expect, it } from "vitest";
import { sentenceCanUseVocabulary } from "./sentence-coverage.js";

describe("sentence vocabulary coverage", () => {
  it("accepts a sentence only when one complete answer can be built from the word library", () => {
    expect(
      sentenceCanUseVocabulary(
        {
          referenceAnswer: "I am eight.",
          acceptedAnswers: ["I'm eight.", "I am eight."]
        },
        ["I", "am", "eight"]
      )
    ).toBe(true);

    expect(
      sentenceCanUseVocabulary(
        {
          referenceAnswer: "Hello, my name is Amy.",
          acceptedAnswers: ["Hello, I am Amy."]
        },
        ["hello", "I", "am", "name", "is"]
      )
    ).toBe(false);
  });

  it("supports multi-word vocabulary entries", () => {
    expect(
      sentenceCanUseVocabulary(
        {
          referenceAnswer: "Thank you.",
          acceptedAnswers: ["Thank you."]
        },
        ["thank you"]
      )
    ).toBe(true);
  });
});
