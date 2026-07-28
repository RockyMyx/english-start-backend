import { describe, expect, it } from "vitest";
import { initialReviewSchedule, updateReviewSchedule } from "./spaced-repetition.js";

describe("spaced repetition", () => {
  it("does not advance multiple stages on the same day", () => {
    const morning = new Date("2026-07-27T01:00:00.000Z");
    const first = updateReviewSchedule(initialReviewSchedule(), "CORRECT", morning);
    const second = updateReviewSchedule(first, "CORRECT", new Date("2026-07-27T02:00:00.000Z"));

    expect(first.reviewStage).toBe(1);
    expect(second.reviewStage).toBe(1);
    expect(second.successfulDays).toBe(1);
  });

  it("advances after a correct answer on another day", () => {
    const first = updateReviewSchedule(
      initialReviewSchedule(),
      "CORRECT",
      new Date("2026-07-27T01:00:00.000Z")
    );
    const second = updateReviewSchedule(
      first,
      "CORRECT",
      new Date("2026-07-28T01:00:00.000Z")
    );

    expect(second.reviewStage).toBe(2);
    expect(second.intervalDays).toBe(3);
  });

  it("resets the stage and schedules a short retry after an error", () => {
    const learned = updateReviewSchedule(
      initialReviewSchedule(),
      "CORRECT",
      new Date("2026-07-27T01:00:00.000Z")
    );
    const failedAt = new Date("2026-07-28T01:00:00.000Z");
    const failed = updateReviewSchedule(learned, "INCORRECT", failedAt);

    expect(failed.reviewStage).toBe(0);
    expect(failed.lapseCount).toBe(1);
    expect(failed.nextReviewAt?.getTime()).toBe(failedAt.getTime() + 10 * 60 * 1000);
  });
});
