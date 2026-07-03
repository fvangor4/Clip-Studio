import Fastify from "fastify";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDb } from "./db";

const dataDir =
  process.env.DATA_DIR ?? (process.platform === "win32" ? "./data" : "/data");
mkdirSync(dataDir, { recursive: true });

export const db = createDb(join(dataDir, "studio.db"));

const app = Fastify({ logger: true });

app.get("/api/health", async () => ({ status: "ok" }));

app.listen({ host: "0.0.0.0", port: 3000 }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
