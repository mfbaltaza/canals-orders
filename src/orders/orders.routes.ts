import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Order, type OrderStatus, Prisma } from "../../generated/prisma/client.ts";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { hashRequest } from "../lib/hash.ts";
import { geocoder, paymentProvider } from "../providers/index.ts";
import { isTestCard } from "../providers/payment/payment.mock.ts";
import type { ChargeResult } from "../providers/payment/payment.provider.ts";
import { rankWarehouses } from "../warehouses/warehouses.ranking.ts";
import { OutOfStock } from "./orders.errors.ts";
import { CreateOrderBody, IdempotencyKey } from "./orders.schemas.ts";

const replayStatusCode: Record<OrderStatus, number> = {
  PAID: 201,
  PAYMENT_FAILED: 402,
  PENDING_PAYMENT: 202,
  EXPIRED: 409,
};

const outOfStockError = {
  error: { code: "OUT_OF_STOCK", message: "No warehouse has enough stock for every item" },
};

const createOrderOptions = {
  config: { rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: "1 minute" } },
};

export async function orderRoutes(fastify: FastifyInstance) {
  fastify.post("/orders", createOrderOptions, async (req, reply) => {
    const parsedIdempotencyKey = IdempotencyKey.safeParse(req.headers["idempotency-key"]);
    if (!parsedIdempotencyKey.success) {
      return reply.code(400).send({
        error: {
          code: "IDEMPOTENCY_KEY_INVALID",
          message: "Missing or invalid Idempotency-Key header",
          details: z.flattenError(parsedIdempotencyKey.error),
        },
      });
    }

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

    const orderKey = {
      customerId: parsedBody.data.customerId,
      idempotencyKey: parsedIdempotencyKey.data,
    };

    const { payment: _payment, ...bodyWithoutPayment } = parsedBody.data;
    const sortedBody = {
      ...bodyWithoutPayment,
      items: bodyWithoutPayment.items.toSorted((a, b) => a.productId.localeCompare(b.productId)),
    };
    const requestHash = hashRequest(sortedBody);

    const replayExisting = async (): Promise<boolean> => {
      const existing = await prisma.order.findUnique({
        where: { customerId_idempotencyKey: orderKey },
      });
      if (!existing) return false;
      reply.code(replayStatusCode[existing.status]).send(existing);
      return true;
    };

    if (await replayExisting()) return reply;

    const cardNumber = parsedBody.data.payment.cardNumber;

    if (!isTestCard(cardNumber)) {
      return reply.code(400).send({
        error: { code: "CARD_NOT_ACCEPTED", message: "Use one of the documented test cards" },
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
    const orderItems = parsedBody.data.items
      .map((p) => {
        const unitPriceCents = priceById.get(p.productId);
        if (unitPriceCents === undefined) throw new Error(`No product price on item ${p.productId}`);
        return {
          productId: p.productId,
          quantity: p.quantity,
          unitPriceCents,
        };
      })
      .sort((a, b) => a.productId.localeCompare(b.productId));

    const totalCents = orderItems.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);

    const dest = await geocoder.geocode(parsedBody.data.shippingAddress);
    if (!dest) {
      return reply.code(422).send({
        error: { code: "ADDRESS_NOT_FOUND", message: "Could not locate the shipping address" },
      });
    }

    const ranked = await rankWarehouses(dest, parsedBody.data.items);
    if (!ranked.length) {
      // A same-key request may have taken the last units: that's this customer's order, not a sell-out
      if (await replayExisting()) return reply;
      return reply.code(409).send(outOfStockError);
    }

    let order: Order | undefined;
    for (const candidate of ranked) {
      try {
        order = await prisma.$transaction(async (tx) => {
          for (const item of orderItems) {
            const { count } = await tx.inventory.updateMany({
              where: {
                warehouseId: candidate.warehouse.id,
                productId: item.productId,
                quantity: { gte: item.quantity },
              },
              data: { quantity: { decrement: item.quantity } },
            });
            if (count === 0) throw new OutOfStock(candidate.warehouse.id, item.productId);
          }

          return await tx.order.create({
            data: {
              customerId: customer.id,
              warehouseId: candidate.warehouse.id,
              totalCents,
              idempotencyKey: parsedIdempotencyKey.data,
              idempotencyRequestHash: requestHash,
              shippingAddress: parsedBody.data.shippingAddress,
              shippingLat: dest.lat,
              shippingLng: dest.lng,
              items: { create: orderItems },
            },
          });
        });
        req.log.info(
          { warehouse: candidate.warehouse.code, distanceInKm: Math.round(candidate.distanceInKm) },
          "warehouse selected",
        );
        break;
      } catch (err) {
        if (err instanceof OutOfStock) continue;
        // A concurrent request with the same key committed first (our transaction rolled back): replay its order
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          if (await replayExisting()) return reply;
        }
        throw err;
      }
    }

    if (order === undefined) {
      if (await replayExisting()) return reply;
      return reply.code(409).send(outOfStockError);
    }

    // After this call money may have moved, so a failure means "unknown" (202), never an error
    let payment: ChargeResult;
    try {
      payment = await paymentProvider.charge({
        cardNumber,
        amountCents: totalCents,
        description: `Order ${order.id}`,
      });
    } catch (err) {
      req.log.error({ err, orderId: order.id }, "charge threw, outcome unknown");
      payment = { status: "unknown" };
    }

    if (payment.status === "approved") {
      try {
        const paidOrder = await prisma.order.update({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { status: "PAID", paymentReference: payment.reference },
        });
        return reply.code(201).send(paidOrder);
      } catch (err) {
        req.log.error(
          { err, orderId: order.id, paymentReference: payment.reference },
          "charged but could not mark PAID",
        );
        return reply.code(202).send(order);
      }
    }

    if (payment.status === "declined") {
      const failedOrder = await prisma.$transaction(async (tx) => {
        const updated = await tx.order.update({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { status: "PAYMENT_FAILED" },
        });
        for (const item of orderItems) {
          await tx.inventory.updateMany({
            where: { warehouseId: order.warehouseId, productId: item.productId },
            data: { quantity: { increment: item.quantity } },
          });
        }
        return updated;
      });
      return reply.code(402).send(failedOrder);
    }

    return reply.code(202).send(order);
  });
}
