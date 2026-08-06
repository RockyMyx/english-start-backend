import { describe, expect, it } from "vitest";
import { weekStartDateKey } from "./date-key.js";

describe("weekStartDateKey", () => {
  it("uses Monday as the first day of the learning week", () => {
    expect(weekStartDateKey("2026-08-03")).toBe("2026-08-03");
    expect(weekStartDateKey("2026-08-05")).toBe("2026-08-03");
    expect(weekStartDateKey("2026-08-09")).toBe("2026-08-03");
  });
});
