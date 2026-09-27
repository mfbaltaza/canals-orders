import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError } from "fastify";
import { Prisma } from "../generated/prisma/client.ts";
import { env } from "./env.ts";
import { orderRoutes } from "./orders/orders.routes.ts";

const fastify = Fastify({
  trustProxy: env.TRUST_PROXY,
  logger: {
    level: env.LOG_LEVEL,
    redact: {
      paths: ["req.headers.authorization", "body.payment.cardNumber", "payment.cardNumber", "cardNumber"],
      censor: "[REDACTED]",
    },
  },
});

fastify.setErrorHandler<FastifyError>((err, req, reply) => {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
    req.log.warn({ err }, "database busy: transaction could not start in time");
    return reply
      .code(503)
      .header("retry-after", "1")
      .send({ error: { code: "SERVICE_BUSY", message: "Too many requests right now, retry shortly" } });
  }
  if (err.statusCode !== undefined && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ error: { code: err.code ?? "BAD_REQUEST", message: err.message } });
  }
  req.log.error({ err }, "unhandled error");
  return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
});

fastify.register(cors, {
  origin: env.CORS_ORIGINS,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Idempotency-Key"],
  exposedHeaders: ["Retry-After", "Request-Id"],
});

if (env.RATE_LIMIT_MAX > 0) {
  const noQuotaHeaders = { "x-ratelimit-limit": false, "x-ratelimit-remaining": false, "x-ratelimit-reset": false };
  fastify.register(rateLimit, {
    global: false,
    addHeadersOnExceeding: noQuotaHeaders,
    addHeaders: noQuotaHeaders,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      code: "RATE_LIMIT",
      message: `Too many requests, retry in ${context.after}`,
    }),
  });
}

fastify.register(orderRoutes);

fastify.get("/", async (_req, _reply) => {
  return { hello: "canals" };
});

const start = async () => {
  try {
    await fastify.listen({ host: env.HOST, port: env.PORT });
  } catch (e) {
    fastify.log.error(e);
    process.exit(1);
  }
};

start();
