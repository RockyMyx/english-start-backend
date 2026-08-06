import "dotenv/config";
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { redemptionCodeHash } from "../src/services/membership-service.js";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function optionValues(name: string): string[] {
  return process.argv.flatMap((value, index) =>
    value === name && process.argv[index + 1] ? [process.argv[index + 1]] : []
  );
}

function integerOption(name: string, fallback: number, min: number, max: number): number {
  const raw = optionValue(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
  }
  return value;
}

function randomSegment(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function generateCode(days: number): string {
  return `ES${days}D-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`;
}

function batches(): Array<{ durationDays: number; count: number }> {
  const batchValues = optionValues("--batch");
  if (!batchValues.length) {
    return [{
      durationDays: integerOption("--days", 7, 1, 3650),
      count: integerOption("--count", 1, 1, 1000)
    }];
  }
  return batchValues.map((value) => {
    const [daysText, countText] = value.split(":");
    const durationDays = Number(daysText);
    const count = Number(countText);
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > 3650 ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 1000
    ) {
      throw new Error("--batch 格式必须是 天数:数量，例如 --batch 7:200");
    }
    return { durationDays, count };
  });
}

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

const requestedBatches = batches();
const offline = process.argv.includes("--offline");
const connectionString = process.env.DATABASE_URL;
if (!offline && !connectionString) throw new Error("DATABASE_URL is required");
const expiresInDaysRaw = optionValue("--expires-in-days");
const expiresInDays = expiresInDaysRaw
  ? integerOption("--expires-in-days", 30, 1, 3650)
  : null;
const label = optionValue("--label")?.trim().slice(0, 80) || null;
const outputPath = optionValue("--output")
  ? path.resolve(optionValue("--output") || "")
  : null;
const expiresAt = expiresInDays
  ? new Date(Date.now() + expiresInDays * 86_400_000)
  : null;
const createdAt = new Date().toISOString();
const codes = requestedBatches.flatMap(({ durationDays, count }) =>
  Array.from({ length: count }, () => ({
    code: generateCode(durationDays),
    durationDays
  }))
);
const prisma = connectionString && !offline
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;
let outputCreated = false;

try {
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const csv = [
      ["code", "membership_days", "label", "generated_at"].map(csvCell).join(","),
      ...codes.map(({ code, durationDays }) =>
        [code, durationDays, label || "", createdAt].map(csvCell).join(",")
      )
    ].join("\r\n");
    await writeFile(outputPath, `\uFEFF${csv}\r\n`, { encoding: "utf8", flag: "wx" });
    outputCreated = true;
  }
  if (prisma) {
    await prisma.membershipRedemptionCode.createMany({
      data: codes.map(({ code, durationDays }) => ({
        codeHash: redemptionCodeHash(code),
        codeHint: code.slice(-4),
        durationDays,
        label,
        expiresAt
      }))
    });
  }
  const summary = requestedBatches
    .map(({ durationDays, count }) => `${durationDays} 天 × ${count} 个`)
    .join("，");
  if (outputPath) {
    process.stdout.write(
      `已生成 ${summary}。文件：${outputPath}${offline ? "（尚未导入数据库）" : ""}\n`
    );
  } else {
    process.stdout.write(
      [`已生成 ${summary}。`, "请妥善保存，以下明文不会写入数据库：", ...codes.map(({ code }) => code)]
        .join("\n") + "\n"
    );
  }
} catch (error) {
  if (outputCreated && outputPath) await rm(outputPath, { force: true });
  throw error;
} finally {
  if (prisma) await prisma.$disconnect();
}
