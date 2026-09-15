import path from "node:path";
import type { PrismaClient } from "../generated/prisma/client.js";

export function validateErasureTarget(userId: string, apply: boolean, confirmation?: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("--user-id 必须是准确的用户 UUID，不支持通配符、昵称或微信标识");
  }
  if (apply && confirmation !== userId) {
    throw new Error("执行删除必须同时提供 --apply --confirm-user-id，并与 --user-id 完全一致");
  }
}

export function resolveAvatarForErasure(storagePath: string, fileName: string | null): string | null {
  if (!fileName) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(fileName)) {
    throw new Error("头像文件名不符合存储规则，需要人工核对，未执行删除");
  }
  const root = path.resolve(storagePath);
  const target = path.resolve(root, fileName);
  if (path.dirname(target) !== root) throw new Error("头像目标超出存储目录");
  return target;
}

export async function previewLearningErasure(client: PrismaClient, userId: string) {
  const user = await client.user.findUnique({ where: { id: userId }, select: { id: true, avatarFileName: true } });
  if (!user) throw new Error("用户不存在，未执行任何修改");
  const where = { userId };
  const [words, attempts, assessments, checkIns, reviews, dailyPlans, consents, sessions, retainedPaymentOrders] = await Promise.all([
    client.vocabularyItem.count({ where }), client.practiceAttempt.count({ where }),
    client.initialAssessment.count({ where }), client.dailyCheckIn.count({ where }),
    client.reviewItemState.count({ where }), client.dailyPlan.count({ where }),
    client.userPrivacyConsent.count({ where }), client.session.count({ where }),
    client.membershipPaymentOrder.count({ where })
  ]);
  return { user, counts: { words, attempts, assessments, checkIns, reviews, dailyPlans, consents, sessions, retainedPaymentOrders } };
}

export async function eraseLearningData(client: PrismaClient, userId: string) {
  // 保留支付凭证、兑换记录及会员有效期；事务内清理学习关联数据并使旧会话失效。
  await client.$transaction(async (tx) => {
    const where = { userId };
    await tx.practiceAttempt.deleteMany({ where });
    await tx.wordProgress.deleteMany({ where });
    await tx.initialAssessment.deleteMany({ where });
    await tx.dailyCheckIn.deleteMany({ where });
    await tx.reviewItemState.deleteMany({ where });
    await tx.dailyPlan.deleteMany({ where });
    await tx.vocabularyItem.deleteMany({ where });
    await tx.userPrivacyConsent.deleteMany({ where });
    await tx.session.deleteMany({ where });
    await tx.user.update({ where: { id: userId }, data: {
      nickname: null, englishName: null, avatarFileName: null,
      learnerAgeBand: null, gradeLevel: null, englishExperience: null, learningGoals: [],
      dailyScoreGoal: 50, weeklyGoalDays: 5
    } });
  });
}
