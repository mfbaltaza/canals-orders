import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.ts";
import { CreateOrderBody } from "./schemas.ts";

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.post("/orders", async (req, reply) => {
    const parsedBody = CreateOrderBody.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.code(400).send(z.flattenError(parsedBody.error));
    }

    const customer = await prisma.customer.findUnique({
      where: { id: parsedBody.data.customerId },
    });
    if (!customer) {
      return reply.code(404).send({ error: "Customer not found" });
    }

    const productIds = parsedBody.data.items.map((product) => product.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const foundProductIds = new Set(products.map((p) => p.id));
    const unknownProductIds = productIds.filter((id) => !foundProductIds.has(id));

    if (unknownProductIds.length) {
      return reply.code(400).send({ error: "Unknown products", unknownProductIds });
    }

    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));
    const totalCents = parsedBody.data.items.reduce((sum, p) => {
      const productPrice = priceById.get(p.productId);
      if (productPrice === undefined) throw new Error(`No product price on item ${p.productId}`);
      return sum + p.quantity * productPrice;
    }, 0);

    const warehouse = await prisma.warehouse.findUniqueOrThrow({
      where: { code: "EAST" },
    });
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        warehouseId: warehouse.id,
        totalCents,
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
