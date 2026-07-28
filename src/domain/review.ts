import type {
  LearningResult,
  PracticeMode,
  ReviewItem,
  ReviewItemStatus,
  ReviewItemType,
  ReviewOverview
} from "./types.js";

export interface ReviewAttemptSnapshot {
  vocabularyItemId: string | null;
  mode: PracticeMode;
  result: LearningResult;
  exerciseKey: string | null;
  promptText: string | null;
  referenceAnswer: string | null;
  occurredAt: Date;
  vocabularyItem?: {
    english: string;
    chinese: string;
  } | null;
}

export interface ReviewStateSnapshot {
  itemType: string;
  itemKey: string;
  masteredAt: Date | null;
  reviewStage: number;
  nextReviewAt: Date | null;
}

export function itemTypeFor(attempt: ReviewAttemptSnapshot): ReviewItemType | null {
  if (attempt.vocabularyItemId) return "WORD";
  if (attempt.mode === "SENTENCE") return "SENTENCE";
  if (attempt.mode === "DIALOGUE_TEXT" || attempt.mode === "DIALOGUE_VOICE") {
    return "DIALOGUE";
  }
  return null;
}

export function itemKeyFor(
  attempt: ReviewAttemptSnapshot,
  type: ReviewItemType
): string | null {
  if (type === "WORD" && attempt.vocabularyItemId) {
    return `word:${attempt.vocabularyItemId}`;
  }
  return attempt.exerciseKey || null;
}

function requiredStreak(type: ReviewItemType): number {
  return type === "WORD" ? 3 : 2;
}

export function buildReviewOverview(
  attempts: ReviewAttemptSnapshot[],
  states: ReviewStateSnapshot[],
  now = new Date()
): ReviewOverview {
  const groups = new Map<string, { type: ReviewItemType; key: string; attempts: ReviewAttemptSnapshot[] }>();
  for (const attempt of attempts) {
    if (attempt.result === "VIEWED") continue;
    const type = itemTypeFor(attempt);
    if (!type) continue;
    const key = itemKeyFor(attempt, type);
    if (!key) continue;
    const groupKey = `${type}:${key}`;
    const current = groups.get(groupKey) || { type, key, attempts: [] };
    current.attempts.push(attempt);
    groups.set(groupKey, current);
  }

  const stateMap = new Map(
    states.map((state) => [`${state.itemType}:${state.itemKey}`, state])
  );
  const items: ReviewItem[] = [];
  for (const group of groups.values()) {
    group.attempts.sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
    const wrong = group.attempts.filter((attempt) => attempt.result === "INCORRECT");
    const lastWrong = wrong[wrong.length - 1] || group.attempts[0];
    const afterLastWrong = group.attempts.filter(
      (attempt) => attempt.occurredAt.getTime() > lastWrong.occurredAt.getTime()
    );
    let correctStreak = 0;
    for (let index = afterLastWrong.length - 1; index >= 0; index -= 1) {
      if (afterLastWrong[index].result !== "CORRECT") break;
      correctStreak += 1;
    }
    const state = stateMap.get(`${group.type}:${group.key}`);
    const scheduledForFuture =
      !!state?.nextReviewAt && state.nextReviewAt.getTime() > now.getTime();
    const manuallyMastered =
      !!state?.masteredAt &&
      !state.nextReviewAt &&
      state.masteredAt.getTime() >= lastWrong.occurredAt.getTime();
    const mastered =
      manuallyMastered ||
      (state ? state.reviewStage >= 5 : correctStreak >= requiredStreak(group.type));
    if (scheduledForFuture && !mastered) continue;
    const status: ReviewItemStatus = mastered ? "MASTERED" : "PENDING";
    const latest = group.attempts[group.attempts.length - 1];
    const word = latest.vocabularyItem || lastWrong.vocabularyItem;
    items.push({
      type: group.type,
      key: group.key,
      status,
      title:
        group.type === "WORD"
          ? word?.english || latest.promptText || "单词"
          : latest.promptText || lastWrong.promptText || "练习题",
      subtitle:
        group.type === "WORD"
          ? word?.chinese || latest.referenceAnswer || ""
          : group.type === "SENTENCE"
            ? "单词造句"
            : "模拟对话",
      promptText: latest.promptText || lastWrong.promptText,
      referenceAnswer: latest.referenceAnswer || lastWrong.referenceAnswer,
      vocabularyItemId: latest.vocabularyItemId,
      wrongCount: wrong.length,
      correctStreak,
      lastWrongAt: lastWrong.occurredAt,
      nextReviewAt: state?.nextReviewAt || null,
      reviewStage: state?.reviewStage || 0,
      modes: [...new Set(group.attempts.map((attempt) => attempt.mode))]
    });
  }
  items.sort((left, right) => right.lastWrongAt.getTime() - left.lastWrongAt.getTime());
  const types: ReviewItemType[] = ["WORD", "SENTENCE", "DIALOGUE"];
  return {
    dueCount: items.filter((item) => item.status === "PENDING").length,
    upcomingCount: states.filter(
      (state) =>
        state.reviewStage < 5 &&
        !!state.nextReviewAt &&
        state.nextReviewAt.getTime() > now.getTime()
    ).length,
    pendingCount: items.filter((item) => item.status === "PENDING").length,
    masteredCount: items.filter((item) => item.status === "MASTERED").length,
    categories: types.map((type) => ({
      type,
      pendingCount: items.filter((item) => item.type === type && item.status === "PENDING").length,
      masteredCount: items.filter((item) => item.type === type && item.status === "MASTERED").length
    })),
    items
  };
}
