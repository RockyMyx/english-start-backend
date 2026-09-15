import "dotenv/config";
import { unlink } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { validateErasureTarget, resolveAvatarForErasure, previewLearningErasure, eraseLearningData } from "../src/services/privacy-erasure.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const userId = option("--user-id") || "";
const apply = process.argv.includes("--apply");
validateErasureTarget(userId, apply, option("--confirm-user-id"));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
try {
  const preview = await previewLearningErasure(client, userId);
  const avatarPath = resolveAvatarForErasure(process.env.AVATAR_STORAGE_PATH || "storage/avatars", preview.user.avatarFileName);
  console.log({ mode: apply ? "apply" : "preview-only", userId, ...preview.counts, currentAvatar: !!avatarPath });
  if (!apply) {
    console.log("仅预览，未修改数据。执行前须完成用户身份核验、备份处理安排，并暂停该用户的数据写入。");
  } else {
    await eraseLearningData(client, userId);
    if (avatarPath) {
      try { await unlink(avatarPath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw new Error("学习数据已删除，但当前头像文件清理失败，请人工清理该文件；不要重复删除数据库");
        }
      }
    }
    console.log("学习数据、当前头像和同意记录已删除，旧会话已失效；支付／兑换记录、账号标识及会员权益保留。历史孤立头像与备份需按运营安排另行清理；这不是完整账号注销。");
  }
} finally { await client.$disconnect(); }
