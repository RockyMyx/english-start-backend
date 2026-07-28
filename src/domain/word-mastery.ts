import type { PracticeMode, WordMastery, WordMasteryStepKey } from "./types.js";

const STEP_DEFINITIONS: Array<{
  key: WordMasteryStepKey;
  label: string;
  modes: PracticeMode[];
}> = [
  {
    key: "RECOGNITION",
    label: "认识",
    modes: ["WORD_READING", "MEANING_CHOOSE_WORD", "WORD_CHOOSE_MEANING"]
  },
  {
    key: "LISTENING",
    label: "听懂",
    modes: ["LISTEN_CHOOSE_MEANING"]
  },
  {
    key: "SPELLING",
    label: "拼写",
    modes: ["DICTATION"]
  },
  {
    key: "SPEAKING",
    label: "会说",
    modes: ["WORD_PRONUNCIATION"]
  },
  {
    key: "USAGE",
    label: "会用",
    modes: ["SENTENCE"]
  }
];

export function buildWordMastery(correctModes: PracticeMode[]): WordMastery {
  const modeSet = new Set(correctModes);
  const steps = STEP_DEFINITIONS.map((step) => ({
    key: step.key,
    label: step.label,
    completed: step.modes.some((mode) => modeSet.has(mode))
  }));
  const completedCount = steps.filter((step) => step.completed).length;
  const highestCompletedStep = [...steps].reverse().find((step) => step.completed);
  return {
    completedCount,
    levelName: highestCompletedStep?.label || "待学习",
    steps
  };
}
