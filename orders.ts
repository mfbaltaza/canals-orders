import type { FastifyInstance } from "fastify";
import { prisma } from "./db.ts";
import { CreateOrderBody } from "./schemas.ts";
import { z } from "zod";

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.post("/orders", async (req, reply) => {
    const parsedBody = CreateOrderBody.safeParse(req.body)
    if (!parsedBody.success) {
      return reply.code(400).send(z.flattenError(parsedBody.error))
    }
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { email: "juan@example.com" },
    });
    const warehouse = await prisma.warehouse.findUniqueOrThrow({
      where: { code: "EAST" },
    });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        warehouseId: warehouse.id,
        totalCents: 1800,
        idempotencyKey: crypto.randomUUID(),
        idempotencyRequestHash: "Hash",
        shippingAddress: parsedBody.data.shippingAddress,
        shippingLat: 0,
        shippingLng: 0,
      },
    });
    return reply.code(201).send(order);
  });
}
