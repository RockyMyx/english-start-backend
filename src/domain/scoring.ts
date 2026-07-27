import type { LearningResult, PracticeMode } from "./types.js";

export const DAILY_SCORE_GOAL = 50;

const correctAnswerPoints: Record<PracticeMode, number> = {
  WORD_READING: 0,
  LISTEN_CHOOSE_MEANING: 1,
  MEANING_CHOOSE_WORD: 1,
  WORD_CHOOSE_MEANING: 1,
  DICTATION: 2,
  SENTENCE: 5,
  DIALOGUE_TEXT: 2,
  DIALOGUE_VOICE: 2
};

export function scoreForAttempt(mode: PracticeMode, result: LearningResult): number {
  return result === "CORRECT" ? correctAnswerPoints[mode] : 0;
}
