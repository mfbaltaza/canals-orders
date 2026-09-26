import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "./db.ts";
import { mockGeocoder } from "./geocoder.ts";
import { CreateOrderBody } from "./schemas.ts";
import { rankWarehouses } from "./warehouse.ts";

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.post("/orders", async (req, reply) => {
    const parsedBody = CreateOrderBody.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid request body",
          details: z.flattenError(parsedBody.error),
        },
      });
    }

    const customer = await prisma.customer.findUnique({
      where: { id: parsedBody.data.customerId },
    });
    if (!customer) {
      return reply.code(404).send({
        error: { code: "CUSTOMER_NOT_FOUND", message: "Customer not found" },
      });
    }

    const productIds = parsedBody.data.items.map((product) => product.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });
    const foundProductIds = new Set(products.map((p) => p.id));
    const unknownProductIds = productIds.filter((id) => !foundProductIds.has(id));

    if (unknownProductIds.length) {
      return reply.code(400).send({
        error: { code: "UNKNOWN_PRODUCTS", message: "Unknown products", details: { unknownProductIds } },
      });
    }

    const priceById = new Map(products.map((p) => [p.id, p.priceCents]));
    const totalCents = parsedBody.data.items.reduce((sum, p) => {
      const productPrice = priceById.get(p.productId);
      if (productPrice === undefined) throw new Error(`No product price on item ${p.productId}`);
      return sum + p.quantity * productPrice;
    }, 0);

    // Valid request, but we can't place the address on a map → 422, not 400
    const dest = await mockGeocoder.geocode(parsedBody.data.shippingAddress);
    if (!dest) {
      return reply.code(422).send({
        error: { code: "ADDRESS_NOT_FOUND", message: "Could not locate the shipping address" },
      });
    }

    // No warehouse has every item right now → 409: a conflict with current stock, may succeed later
    const ranked = await rankWarehouses(dest, parsedBody.data.items);
    const [nearest] = ranked;
    if (!nearest) {
      return reply.code(409).send({
        error: { code: "OUT_OF_STOCK", message: "No warehouse has enough stock for every item" },
      });
    }
    req.log.info(
      { warehouse: nearest.warehouse.code, distanceInKm: Math.round(nearest.distanceInKm) },
      "warehouse selected",
    );

    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        warehouseId: nearest.warehouse.id,
        totalCents,
        idempotencyKey: crypto.randomUUID(),
        idempotencyRequestHash: "Hash",
        shippingAddress: parsedBody.data.shippingAddress,
        shippingLat: dest.lat,
        shippingLng: dest.lng,
      },
    });
    return reply.code(201).send(order);
  });
}
