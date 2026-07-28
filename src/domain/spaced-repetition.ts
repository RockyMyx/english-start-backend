import { shanghaiDateKey } from "./date-key.js";
import type { LearningResult } from "./types.js";

const REVIEW_DELAYS_MS = [
  10 * 60 * 1000,
  24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  14 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000
];

export interface ReviewScheduleState {
  reviewStage: number;
  intervalDays: number;
  nextReviewAt: Date | null;
  lastReviewedAt: Date | null;
  lastResult: LearningResult | null;
  lapseCount: number;
  successfulDays: number;
  masteredAt: Date | null;
}

export function initialReviewSchedule(): ReviewScheduleState {
  return {
    reviewStage: 0,
    intervalDays: 0,
    nextReviewAt: null,
    lastReviewedAt: null,
    lastResult: null,
    lapseCount: 0,
    successfulDays: 0,
    masteredAt: null
  };
}

export function updateReviewSchedule(
  current: ReviewScheduleState,
  result: LearningResult,
  now = new Date()
): ReviewScheduleState {
  if (result === "VIEWED") {
    return { ...current, lastReviewedAt: now, lastResult: result };
  }

  if (result === "INCORRECT") {
    return {
      ...current,
      reviewStage: 0,
      intervalDays: 0,
      nextReviewAt: new Date(now.getTime() + REVIEW_DELAYS_MS[0]),
      lastReviewedAt: now,
      lastResult: result,
      lapseCount: current.lapseCount + 1,
      masteredAt: null
    };
  }

  const reviewedOnNewDay =
    !current.lastReviewedAt ||
    shanghaiDateKey(current.lastReviewedAt) !== shanghaiDateKey(now);
  const nextStage = reviewedOnNewDay
    ? Math.min(current.reviewStage + 1, REVIEW_DELAYS_MS.length - 1)
    : current.reviewStage;
  const delay = REVIEW_DELAYS_MS[Math.max(1, nextStage)];
  const intervalDays = Math.max(1, Math.round(delay / (24 * 60 * 60 * 1000)));
  const successfulDays = current.successfulDays + (reviewedOnNewDay ? 1 : 0);

  return {
    ...current,
    reviewStage: nextStage,
    intervalDays,
    nextReviewAt: new Date(now.getTime() + delay),
    lastReviewedAt: now,
    lastResult: result,
    successfulDays,
    masteredAt: nextStage >= REVIEW_DELAYS_MS.length - 1 ? now : current.masteredAt
  };
}
