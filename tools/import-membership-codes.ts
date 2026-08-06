import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { redemptionCodeHash } from "../src/services/membership-service.js";

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const input = optionValue("--input");
if (!input) throw new Error("请使用 --input 指定兑换码 CSV 文件");
const migrationOutput = optionValue("--migration-output");
const connectionString = process.env.DATABASE_URL;
if (!migrationOutput && !connectionString) throw new Error("DATABASE_URL is required");

const inputPath = path.resolve(input);
const content = (await readFile(inputPath, "utf8")).replace(/^\uFEFF/, "");
const lines = content.split(/\r?\n/).filter(Boolean);
const header = parseCsvLine(lines.shift() || "");
if (header[0] !== "code" || header[1] !== "membership_days") {
  throw new Error("兑换码文件格式不正确");
}
const rows = lines.map((line, index) => {
  const [code, durationText, label] = parseCsvLine(line);
  const durationDays = Number(durationText);
  if (!code || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
    throw new Error(`第 ${index + 2} 行兑换码格式不正确`);
  }
  return {
    codeHash: redemptionCodeHash(code),
    codeHint: code.slice(-4),
    durationDays,
    label: label || null
  };
});
if (!rows.length) throw new Error("兑换码文件中没有数据");
if (new Set(rows.map((row) => row.codeHash)).size !== rows.length) {
  throw new Error("兑换码文件中存在重复码");
}

if (migrationOutput) {
  const outputPath = path.resolve(migrationOutput);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const values = rows.map((row) =>
    `(${sqlString(randomUUID())}, ${sqlString(row.codeHash)}, ${sqlString(row.codeHint)}, ${row.durationDays}, ${row.label ? sqlString(row.label) : "NULL"}, CURRENT_TIMESTAMP)`
  );
  const sql = [
    "-- Initial one-time membership codes. Plaintext codes are stored outside the repository.",
    "INSERT INTO \"MembershipRedemptionCode\" (\"id\", \"codeHash\", \"codeHint\", \"durationDays\", \"label\", \"createdAt\") VALUES",
    `${values.join(",\n")};`,
    ""
  ].join("\n");
  await writeFile(outputPath, sql, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`已生成仅含哈希的迁移：${outputPath}\n`);
  process.exit(0);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString || "" }) });
try {
  const result = await prisma.membershipRedemptionCode.createMany({
    data: rows,
    skipDuplicates: true
  });
  process.stdout.write(`文件共 ${rows.length} 个兑换码，本次成功导入 ${result.count} 个。\n`);
} finally {
  await prisma.$disconnect();
}
