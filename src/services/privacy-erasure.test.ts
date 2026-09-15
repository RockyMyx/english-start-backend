import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { validateErasureTarget, resolveAvatarForErasure, eraseLearningData } from "./privacy-erasure.js";

const userId = "00000000-0000-4000-8000-000000000001";

describe("learning data erasure", () => {
  it("requires an exact UUID and a matching second confirmation for apply", () => {
    expect(() => validateErasureTarget(userId, false)).not.toThrow();
    expect(() => validateErasureTarget("*", false)).toThrow();
    expect(() => validateErasureTarget("learner-name", true, "learner-name")).toThrow();
    expect(() => validateErasureTarget(userId, true)).toThrow();
    expect(() => validateErasureTarget(userId, true, "other")).toThrow();
    expect(() => validateErasureTarget(userId, true, userId)).not.toThrow();
  });

  it("never accepts broad or traversal avatar targets", () => {
    expect(resolveAvatarForErasure("storage/avatars", null)).toBeNull();
    expect(resolveAvatarForErasure("storage/avatars", `${userId}.png`)).toContain(`${userId}.png`);
    for (const target of ["../secret", "..\\secret", "/", "C:\\", "*.png", "plain.png"]) {
      expect(() => resolveAvatarForErasure("storage/avatars", target)).toThrow();
    }
  });

  it("cleans learning data atomically without removing billing identity or membership", async () => {
    const names = ["practiceAttempt", "wordProgress", "initialAssessment", "dailyCheckIn", "reviewItemState", "dailyPlan", "vocabularyItem", "userPrivacyConsent", "session"];
    const tx: Record<string, any> = Object.fromEntries(names.map((name) => [name, { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) }]));
    tx.user = { update: vi.fn().mockResolvedValue({}) };
    tx.membershipPaymentOrder = { deleteMany: vi.fn() };
    const client = { $transaction: vi.fn(async (action) => action(tx)) } as unknown as PrismaClient;
    await eraseLearningData(client, userId);
    for (const name of names) expect(tx[name].deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(tx.membershipPaymentOrder.deleteMany).not.toHaveBeenCalled();
    const update = tx.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: userId });
    expect(update.data).not.toHaveProperty("membershipExpiresAt");
    expect(update.data).not.toHaveProperty("wechatOpenId");
    expect(update.data.learningGoals).toEqual([]);
    expect(client.$transaction).toHaveBeenCalledOnce();
  });
});
