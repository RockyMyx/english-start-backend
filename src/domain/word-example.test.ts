import { describe, expect, it } from "vitest";
import { buildWordExamples } from "./word-example.js";

describe("word examples", () => {
  it("returns an example only when the displayed sentence uses the user's words", () => {
    const words = [
      { id: "i", english: "I" },
      { id: "am", english: "am" },
      { id: "eight", english: "eight" },
      { id: "apple", english: "apple" }
    ];
    const examples = buildWordExamples(words, [
      { referenceAnswer: "I am eight.", promptChinese: "我八岁。" },
      { referenceAnswer: "I have an apple.", promptChinese: "我有一个苹果。" }
    ]);
    expect(examples).toHaveLength(3);
    expect(examples.find((item) => item.wordId === "eight")).toMatchObject({
      english: "I am eight.",
      chinese: "我八岁。",
      before: "I am ",
      focus: "eight",
      after: "."
    });
    expect(examples.some((item) => item.wordId === "apple")).toBe(false);
  });

  it("matches whole words and multi-word entries without matching substrings", () => {
    const examples = buildWordExamples(
      [
        { id: "a", english: "a" },
        { id: "thank", english: "thank you" },
        { id: "banana", english: "banana" }
      ],
      [{ referenceAnswer: "Thank you.", promptChinese: "谢谢你。" }]
    );
    expect(examples.map((item) => item.wordId)).toEqual(["thank"]);
    expect(examples[0].focus).toBe("Thank you");
  });
});
