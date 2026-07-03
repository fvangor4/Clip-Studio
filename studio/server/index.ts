import Fastify, { type FastifyInstance } from "fastify";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, type Db } from "./db.js";
import { registerRoutes } from "./routes.js";

export function buildApp(db: Db, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.get("/api/health", async () => ({ status: "ok" }));
  registerRoutes(app, db);
  return app;
}

function main(): void {
  const dataDir =
    process.env.DATA_DIR ?? (process.platform === "win32" ? "./data" : "/data");
  mkdirSync(dataDir, { recursive: true });
  const db = createDb(join(dataDir, "studio.db"));

  const app = buildApp(db, { logger: true });
  app.listen({ host: "0.0.0.0", port: 3000 }).catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
