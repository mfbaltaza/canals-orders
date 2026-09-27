import { setTimeout as sleep } from "node:timers/promises";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.ts";

const DB_PING_TIMEOUT_MS = 2000;

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/healthz", async (req, reply) => {
    try {
      // A hanging database would otherwise hang the probe too
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        sleep(DB_PING_TIMEOUT_MS, undefined, { ref: false }).then(() => {
          throw new Error(`database ping timed out after ${DB_PING_TIMEOUT_MS}ms`);
        }),
      ]);
      return { status: "ok" };
    } catch (err) {
      req.log.error({ err }, "health check failed: database unreachable");
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is unreachable" } });
    }
  });
}
