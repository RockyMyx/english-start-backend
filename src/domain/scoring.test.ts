import { describe, expect, it } from "vitest";
import { DAILY_SCORE_GOAL, scoreForAttempt } from "./scoring.js";

describe("practice scoring", () => {
  it("uses the same point weights as the learning modes", () => {
    expect(DAILY_SCORE_GOAL).toBe(50);
    expect(scoreForAttempt("LISTEN_CHOOSE_MEANING", "CORRECT")).toBe(1);
    expect(scoreForAttempt("MEANING_CHOOSE_WORD", "CORRECT")).toBe(1);
    expect(scoreForAttempt("WORD_CHOOSE_MEANING", "CORRECT")).toBe(1);
    expect(scoreForAttempt("DICTATION", "CORRECT")).toBe(2);
    expect(scoreForAttempt("DIALOGUE_TEXT", "CORRECT")).toBe(2);
    expect(scoreForAttempt("DIALOGUE_VOICE", "CORRECT")).toBe(2);
    expect(scoreForAttempt("SENTENCE", "CORRECT")).toBe(5);
    expect(scoreForAttempt("SENTENCE", "INCORRECT")).toBe(0);
  });
});
