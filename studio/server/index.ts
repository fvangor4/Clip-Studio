import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDb, type Db } from "./db.js";
import { registerRoutes } from "./routes.js";

export function buildApp(db: Db, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.get("/api/health", async () => ({ status: "ok" }));
  registerRoutes(app, db);

  // Serve the built web UI when it exists, with SPA fallback for non-API paths.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
  if (existsSync(join(webDist, "index.html"))) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

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
