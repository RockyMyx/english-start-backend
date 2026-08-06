import type {
  CapabilityKey,
  AssessmentScores,
  LearningGoal,
  LearningResult,
  PersonalizedLearningReport,
  PracticeMode,
  WeakWordRecord
} from "../domain/types.js";
import { shanghaiDateKey, shiftDateKey } from "../domain/date-key.js";

export interface ReportAttemptSnapshot {
  mode: PracticeMode;
  result: LearningResult;
  occurredAt: Date;
  vocabularyItemId: string | null;
  vocabularyEnglish: string | null;
  answerText: string | null;
  recognizedText: string | null;
  promptText: string | null;
  referenceAnswer: string | null;
  semanticScore: number | null;
  pronunciationScore: number | null;
}

const capabilityModes: Record<CapabilityKey, PracticeMode[]> = {
  RECOGNITION: ["LISTEN_CHOOSE_MEANING", "MEANING_CHOOSE_WORD", "WORD_CHOOSE_MEANING"],
  SPELLING: ["DICTATION"],
  PRONUNCIATION: ["WORD_PRONUNCIATION"],
  EXPRESSION: ["SENTENCE", "DIALOGUE_TEXT", "DIALOGUE_VOICE"]
};

const capabilityLabels: Record<CapabilityKey, string> = {
  RECOGNITION: "认读",
  SPELLING: "拼写",
  PRONUNCIATION: "发音",
  EXPRESSION: "表达"
};

const goalCapability: Partial<Record<LearningGoal, CapabilityKey>> = {
  VOCABULARY: "RECOGNITION",
  SPELLING: "SPELLING",
  PRONUNCIATION: "PRONUNCIATION",
  SPEAKING: "EXPRESSION",
  SCHOOL: "SPELLING"
};

function inRange(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey <= end;
}

function accuracy(attempts: ReportAttemptSnapshot[]): number | null {
  const graded = attempts.filter((attempt) => attempt.result !== "VIEWED");
  if (!graded.length) return null;
  return Math.round((graded.filter((attempt) => attempt.result === "CORRECT").length / graded.length) * 100);
}

function trend(current: number | null, previous: number | null) {
  if (current === null || previous === null) return "INSUFFICIENT" as const;
  if (current >= previous + 5) return "UP" as const;
  if (current <= previous - 5) return "DOWN" as const;
  return "STABLE" as const;
}

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function recognitionMastery(
  attempts: ReportAttemptSnapshot[]
): Array<{ english: string; masteredAt: string }> {
  const groups = new Map<string, { english: string; dates: string[] }>();
  for (const attempt of attempts) {
    if (
      attempt.result !== "CORRECT" ||
      !attempt.vocabularyItemId ||
      !attempt.vocabularyEnglish ||
      !capabilityModes.RECOGNITION.includes(attempt.mode)
    ) continue;
    const current = groups.get(attempt.vocabularyItemId) || {
      english: attempt.vocabularyEnglish,
      dates: []
    };
    current.dates.push(shanghaiDateKey(attempt.occurredAt));
    groups.set(attempt.vocabularyItemId, current);
  }
  return [...groups.values()].flatMap((group) => {
    const dates = distinct(group.dates).sort();
    return dates.length >= 2 ? [{ english: group.english, masteredAt: dates[1] }] : [];
  });
}

function spellingMastery(
  attempts: ReportAttemptSnapshot[]
): Array<{ english: string; masteredAt: string }> {
  const groups = new Map<string, ReportAttemptSnapshot[]>();
  for (const attempt of attempts) {
    if (attempt.mode !== "DICTATION" || !attempt.vocabularyItemId || !attempt.vocabularyEnglish) continue;
    const current = groups.get(attempt.vocabularyItemId) || [];
    current.push(attempt);
    groups.set(attempt.vocabularyItemId, current);
  }
  return [...groups.values()].flatMap((group) => {
    const sorted = group.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index - 1].result === "CORRECT" && sorted[index].result === "CORRECT") {
        return [{
          english: sorted[index].vocabularyEnglish || "",
          masteredAt: shanghaiDateKey(sorted[index].occurredAt)
        }];
      }
    }
    return [];
  });
}

function safeEvidence(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 80 || /^[0-9a-f-]{20,}$/i.test(cleaned)) return null;
  return cleaned;
}

export function buildPersonalizedLearningReport(input: {
  generatedDate: string;
  attempts: ReportAttemptSnapshot[];
  weakWords: WeakWordRecord[];
  learningGoals: LearningGoal[];
  baseline?: {
    level: string;
    scores: AssessmentScores;
    completedAt: Date;
  } | null;
}): PersonalizedLearningReport {
  const currentStart = shiftDateKey(input.generatedDate, -6);
  const previousStart = shiftDateKey(input.generatedDate, -13);
  const previousEnd = shiftDateKey(input.generatedDate, -7);
  const currentAttempts = input.attempts.filter((attempt) =>
    inRange(shanghaiDateKey(attempt.occurredAt), currentStart, input.generatedDate)
  );
  const previousAttempts = input.attempts.filter((attempt) =>
    inRange(shanghaiDateKey(attempt.occurredAt), previousStart, previousEnd)
  );
  const recognition = recognitionMastery(input.attempts);
  const spelling = spellingMastery(input.attempts);
  const newlyMasteredWords = distinct(
    [...recognition, ...spelling]
      .filter((item) => inRange(item.masteredAt, currentStart, input.generatedDate))
      .map((item) => item.english)
  ).slice(0, 12);

  const latestPronunciation = new Map<string, ReportAttemptSnapshot>();
  for (const attempt of input.attempts) {
    if (attempt.mode !== "WORD_PRONUNCIATION" || !attempt.vocabularyEnglish) continue;
    const current = latestPronunciation.get(attempt.vocabularyEnglish);
    if (!current || current.occurredAt < attempt.occurredAt) {
      latestPronunciation.set(attempt.vocabularyEnglish, attempt);
    }
  }
  const pronunciationPassed = [...latestPronunciation.values()].filter(
    (attempt) => (attempt.pronunciationScore || 0) >= 60
  );
  const currentExpressions = currentAttempts.filter(
    (attempt) => capabilityModes.EXPRESSION.includes(attempt.mode) && attempt.result === "CORRECT"
  );
  const studyDays = new Set(currentAttempts.map((attempt) => shanghaiDateKey(attempt.occurredAt))).size;

  const capabilityCounts: Record<CapabilityKey, number> = {
    RECOGNITION: recognition.length,
    SPELLING: spelling.length,
    PRONUNCIATION: pronunciationPassed.length,
    EXPRESSION: currentExpressions.length
  };
  const basis: Record<CapabilityKey, string> = {
    RECOGNITION: "同一词在不同日期多次选择正确",
    SPELLING: "同一词最近连续两次听写正确",
    PRONUNCIATION: "最近一次发音评分达到通过标准",
    EXPRESSION: "本周造句或对话语义判断通过"
  };
  const performance: Record<CapabilityKey, string> = {
    RECOGNITION: `稳定认读 ${capabilityCounts.RECOGNITION} 个词`,
    SPELLING: `能独立拼写 ${capabilityCounts.SPELLING} 个词`,
    PRONUNCIATION: `${capabilityCounts.PRONUNCIATION} 个词达到通过标准`,
    EXPRESSION: `本周完成 ${capabilityCounts.EXPRESSION} 个有效表达`
  };

  const capabilityKeys: CapabilityKey[] = ["RECOGNITION", "SPELLING", "PRONUNCIATION", "EXPRESSION"];
  const capabilities = capabilityKeys.map((key) => {
    const current = accuracy(currentAttempts.filter((attempt) => capabilityModes[key].includes(attempt.mode)));
    const previous = accuracy(previousAttempts.filter((attempt) => capabilityModes[key].includes(attempt.mode)));
    return {
      key,
      label: capabilityLabels[key],
      performance: performance[key],
      basis: basis[key],
      trend: trend(current, previous)
    };
  });

  const scoredCapabilities = capabilityKeys.map((key) => ({
    key,
    score: accuracy(currentAttempts.filter((attempt) => capabilityModes[key].includes(attempt.mode)))
  }));
  const weakFocus = scoredCapabilities
    .filter((item) => item.score === null || item.score < 70)
    .sort((left, right) => (left.score ?? -1) - (right.score ?? -1))
    .map((item) => item.key);
  const goalFocus = distinct(
    input.learningGoals
      .map((goal) => goalCapability[goal])
      .filter((key): key is CapabilityKey => Boolean(key))
  );
  const baselineScores: Record<CapabilityKey, number | null> | null = input.baseline
    ? {
        RECOGNITION: input.baseline.scores.recognition,
        SPELLING: input.baseline.scores.spelling,
        PRONUNCIATION: input.baseline.scores.pronunciation,
        EXPRESSION: input.baseline.scores.expression
      }
    : null;
  const baselineFocus = baselineScores
    ? capabilityKeys
        .filter((key) => baselineScores[key] === null || (baselineScores[key] || 0) < 70)
        .sort((left, right) => (baselineScores[left] ?? -1) - (baselineScores[right] ?? -1))
    : [];
  const focusDimensions = distinct([...goalFocus, ...baselineFocus, ...weakFocus]);
  if (!focusDimensions.length) focusDimensions.push("EXPRESSION");

  const improving = capabilities.find((item) => item.trend === "UP");
  const needsWork = capabilities.find((item) => item.trend === "DOWN") ||
    capabilities.find((item) => focusDimensions.includes(item.key));
  const summary = currentAttempts.length
    ? `本周学习 ${studyDays} 天，新增掌握 ${newlyMasteredWords.length} 个词${improving ? `，${improving.label}表现有所提升` : "，整体表现保持稳定"}${needsWork ? `，${needsWork.label}仍需加强` : "。"}`
    : "本周还没有足够的练习记录，完成几次练习后将生成更准确的能力分析。";

  const expressions = distinct(
    currentExpressions
      .map((attempt) => safeEvidence(attempt.recognizedText) || safeEvidence(attempt.answerText))
      .filter((value): value is string => Boolean(value))
  ).slice(0, 4);
  const pronunciationHighlights = distinct(
    pronunciationPassed
      .filter((attempt) => inRange(shanghaiDateKey(attempt.occurredAt), currentStart, input.generatedDate))
      .map((attempt) => attempt.vocabularyEnglish || "")
      .filter(Boolean)
  ).slice(0, 6);
  const confusions = distinct(
    currentAttempts
      .filter((attempt) => attempt.result === "INCORRECT" && attempt.mode === "DICTATION")
      .map((attempt) => {
        const actual = safeEvidence(attempt.answerText);
        const expected = safeEvidence(attempt.promptText);
        return actual && expected && actual.toLowerCase() !== expected.toLowerCase()
          ? `${actual}／${expected}`
          : null;
      })
      .filter((value): value is string => Boolean(value))
  ).slice(0, 6);
  const weakWordNames = input.weakWords.slice(0, 5).map((word) => word.english);
  const focusLabel = focusDimensions.slice(0, 2).map((key) => capabilityLabels[key]).join("和");
  const nextStep = weakWordNames.length
    ? `下周继续复习 ${weakWordNames.join("、")}，并重点加强${focusLabel}练习。`
    : `下周保持当前学习节奏，并重点加强${focusLabel}练习。`;

  return {
    summary,
    baseline: input.baseline || null,
    capabilities,
    evidence: {
      newlyMasteredWords,
      expressions,
      pronunciationHighlights,
      confusions
    },
    nextStep,
    focusDimensions
  };
}
