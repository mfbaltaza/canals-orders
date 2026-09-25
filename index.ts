import Fastify from "fastify";
import { env } from "./env.ts";
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
