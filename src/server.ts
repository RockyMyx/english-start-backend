import "dotenv/config";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { PrismaAppRepository } from "./repositories/prisma-repository.js";

const config = loadConfig();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const repository = new PrismaAppRepository(connectionString);
const app = await buildApp({ repository, config });

const shutdown = async () => {
  await app.close();
  await repository.client.$disconnect();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ host: config.host, port: config.port });
