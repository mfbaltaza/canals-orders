import Fastify from "fastify";

const fastify = Fastify({
  logger: true,
});

fastify.get("/", async (req, reply) => {
  return { hello: "world" };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000 });
  } catch (e) {
    fastify.log.error(e);
    process.exit(1);
  }
};

start();
