import type { Prisma } from "../../generated/prisma/client.ts";

export const orderResponseInclude = {
  items: { orderBy: { productId: "asc" } },
} satisfies Prisma.OrderInclude;

type OrderWithItems = Prisma.OrderGetPayload<{ include: typeof orderResponseInclude }>;

export function toOrderResponse(order: OrderWithItems) {
  return {
    id: order.id,
    customerId: order.customerId,
    warehouseId: order.warehouseId,
    status: order.status,
    totalCents: order.totalCents,
    shippingAddress: order.shippingAddress,
    paymentReference: order.paymentReference,
    items: order.items.map(({ productId, quantity, unitPriceCents }) => ({
      productId,
      quantity,
      unitPriceCents,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
