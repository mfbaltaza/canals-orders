import Fastify, { type FastifyError } from "fastify";
import { env } from "./env.ts";
import { Prisma } from "./generated/prisma/client.ts";
import { orderRoutes } from "./orders.ts";

const fastify = Fastify({
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

fastify.register(orderRoutes);

fastify.get("/", async (req, reply) => {
  return { hello: "world" };
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
