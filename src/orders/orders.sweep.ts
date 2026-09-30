import type { FastifyBaseLogger } from "fastify";
import type { PaymentAttempt } from "../../generated/prisma/client.ts";
import { prisma } from "../db.ts";
import { paymentProvider } from "../providers/index.ts";
import { chargeDescription } from "./orders.charge.ts";

export type SweepResult = {
  orderId: string;
  attemptStatus: PaymentAttempt["status"] | "NONE";
  outcome: "PAID" | "PAYMENT_FAILED" | "skipped" | "superseded" | "failed";
  reference?: string;
  error?: unknown;
};

type Resolution = { status: "PAID"; reference: string } | { status: "PAYMENT_FAILED"; reason: string };

const findStaleOrders = (cutoff: Date, limit: number) =>
  prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lte: cutoff } },
    include: { items: true, paymentAttempts: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

type StaleOrder = Awaited<ReturnType<typeof findStaleOrders>>[number];

async function reconcile(order: StaleOrder): Promise<Resolution | null> {
  const attempt = order.paymentAttempts[0];
  // A missing record does not rule out a charge still in flight.
  if (!attempt) return null;
  if (attempt.amountCents !== order.totalCents) throw new Error("Payment attempt amount does not match order");

  switch (attempt.status) {
    case "APPROVED":
      return attempt.reference ? { status: "PAID", reference: attempt.reference } : null;
    case "DECLINED":
      return { status: "PAYMENT_FAILED", reason: attempt.declineReason ?? "card_declined" };
    case "PENDING":
    case "UNKNOWN": {
      const found = await paymentProvider.findChargeByDescription(chargeDescription(order.id));
      if (found.status === "unknown") return null;
      if (found.amountCents !== order.totalCents) throw new Error("Provider charge amount does not match order");
      return found.status === "approved"
        ? { status: "PAID", reference: found.reference }
        : { status: "PAYMENT_FAILED", reason: found.reason };
    }
  }
}

// false: someone else closed the order first, and whoever did also handled its stock
async function apply(order: StaleOrder, resolution: Resolution): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: "PENDING_PAYMENT" },
      data:
        resolution.status === "PAID"
          ? { status: "PAID", paymentReference: resolution.reference }
          : { status: resolution.status },
    });
    if (count === 0) return false;
    const attempt = order.paymentAttempts[0];
    if (attempt) {
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data:
          resolution.status === "PAID"
            ? { status: "APPROVED", reference: resolution.reference, declineReason: null }
            : { status: "DECLINED", declineReason: resolution.reason, reference: null },
      });
    }
    if (resolution.status === "PAID") return true;

    // Same lock order as the reservation, so releasing stock can't deadlock with a new order
    const items = order.items.toSorted((a, b) => a.productId.localeCompare(b.productId));
    for (const item of items) {
      await tx.inventory.updateMany({
        where: { warehouseId: order.warehouseId, productId: item.productId },
        data: { quantity: { increment: item.quantity } },
      });
    }
    return true;
  });
}

export async function sweepOnce({ staleAfterMs, limit = 100 }: { staleAfterMs: number; limit?: number }) {
  const orders = await findStaleOrders(new Date(Date.now() - staleAfterMs), limit);
  const results: SweepResult[] = [];

  for (const order of orders) {
    const result: SweepResult = {
      orderId: order.id,
      attemptStatus: order.paymentAttempts[0]?.status ?? "NONE",
      outcome: "skipped",
    };
    results.push(result);

    try {
      const resolution = await reconcile(order);
      if (!resolution) continue;
      if (resolution.status === "PAID") result.reference = resolution.reference;
      result.outcome = (await apply(order, resolution)) ? resolution.status : "superseded";
    } catch (err) {
      result.outcome = "failed";
      result.error = err;
    }
  }

  return results;
}

// Each pass is scheduled when the previous one ends, so passes never overlap
export function startSweeper(
  { intervalMs, staleAfterMs }: { intervalMs: number; staleAfterMs: number },
  log: FastifyBaseLogger,
) {
  let timer: NodeJS.Timeout | undefined;
  let pass: Promise<void> | undefined;
  let stopped = false;

  const run = async () => {
    try {
      for (const { error, ...result } of await sweepOnce({ staleAfterMs })) {
        if (result.outcome === "failed") log.error({ err: error, ...result }, "sweeper could not resolve order");
        else if (result.outcome === "skipped") log.warn(result, "sweeper can't decide on order");
        else log.info(result, "sweeper resolved order");
      }
    } catch (err) {
      log.error({ err }, "sweeper pass failed");
    }
  };

  const schedule = () => {
    timer = setTimeout(() => {
      pass = run().finally(() => {
        pass = undefined;
        if (!stopped) schedule();
      });
    }, intervalMs);
  };
  schedule();

  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    await pass;
  };
}
