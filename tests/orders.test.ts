import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import Fastify from "fastify";
import { prisma } from "../src/db.ts";
import { chargeDescription } from "../src/orders/orders.charge.ts";
import { orderRoutes } from "../src/orders/orders.routes.ts";
import { sweepOnce } from "../src/orders/orders.sweep.ts";
import { mockPaymentProvider, TEST_CARDS } from "../src/providers/payment/payment.mock.ts";
import { withChargeTimeout } from "../src/providers/payment/payment.resilience.ts";

if (process.env.NODE_ENV !== "test" || new URL(process.env.DATABASE_URL ?? "").pathname !== "/payment_review") {
  throw new Error("Use NODE_ENV=test and a dedicated database named payment_review");
}
const prefix = `recovery-${randomUUID()}`;
const customerId = `${prefix}-cus`;
const productId = `${prefix}-prod`;
const warehouseId = `${prefix}-wh`;
const app = Fastify();
const body = (cardNumber: string) => ({
  customerId,
  shippingAddress: { line1: "350 5th Ave", city: "New York", region: "NY", postalCode: "10118", country: "US" },
  items: [{ productId, quantity: 1 }],
  payment: { cardNumber },
});
const stock = async () =>
  (
    await prisma.inventory.findUniqueOrThrow({
      where: { warehouseId_productId: { warehouseId, productId } },
    })
  ).quantity;
const place = async (card: string, key = randomUUID()) =>
  app.inject({
    method: "POST",
    url: "/orders",
    headers: { "idempotency-key": key },
    payload: body(card),
  });
const stale = async (id: string) =>
  prisma.order.update({
    where: { id },
    data: { createdAt: new Date(Date.now() - 100_000) },
  });

before(async () => {
  await prisma.customer.create({ data: { id: customerId, email: `${prefix}@example.com`, name: "Recovery test" } });
  await prisma.product.create({ data: { id: productId, sku: productId, name: "Test", priceCents: 1000 } });
  await prisma.warehouse.create({
    data: { id: warehouseId, code: warehouseId, name: "Test", lat: 40.7128, lng: -74.006 },
  });
  await prisma.inventory.create({ data: { warehouseId, productId, quantity: 100 } });
  await app.register(orderRoutes);
  await app.ready();
});

after(async () => {
  const orders = await prisma.order.findMany({ where: { customerId } });
  await prisma.mockCharge.deleteMany({ where: { description: { in: orders.map((o) => chargeDescription(o.id)) } } });
  await prisma.mockCharge.deleteMany({ where: { description: { startsWith: prefix } } });
  await prisma.order.deleteMany({ where: { customerId } });
  await prisma.customer.delete({ where: { id: customerId } });
  await prisma.product.delete({ where: { id: productId } });
  await prisma.warehouse.delete({ where: { id: warehouseId } });
  await app.close();
  await prisma.$disconnect();
});

test("approval and replay use the same charge", async () => {
  const beforeStock = await stock();
  const key = randomUUID();
  const response = await place(TEST_CARDS.approved, key);
  assert.equal(response.statusCode, 201);
  const order = response.json();
  assert.deepEqual(Object.keys(order).sort(), [
    "createdAt",
    "customerId",
    "id",
    "items",
    "paymentReference",
    "shippingAddress",
    "status",
    "totalCents",
    "updatedAt",
    "warehouseId",
  ]);
  assert.deepEqual(order.items, [{ productId, quantity: 1, unitPriceCents: 1000 }]);
  const found = await mockPaymentProvider.findChargeByDescription(chargeDescription(order.id));
  assert.deepEqual(found, { status: "approved", reference: order.paymentReference, amountCents: 1000 });
  const replay = await place(TEST_CARDS.approved, key);
  assert.deepEqual(replay.json(), order);
  assert.equal(await stock(), beforeStock - 1);
  assert.equal(await prisma.mockCharge.count({ where: { description: chargeDescription(order.id) } }), 1);
});

test("lost response is recoverable in a new process", async () => {
  const response = await place(TEST_CARDS.unknown);
  assert.equal(response.statusCode, 202);
  const order = response.json();
  const description = chargeDescription(order.id);
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    const { mockPaymentProvider } = await import('./src/providers/payment/payment.mock.ts');
    const { prisma } = await import('./src/db.ts');
    console.log(JSON.stringify(await mockPaymentProvider.findChargeByDescription(${JSON.stringify(description)})));
    await prisma.$disconnect();
  `,
    ],
    { encoding: "utf8" },
  );
  const found = JSON.parse(output.trim());
  assert.equal(found.status, "approved");
  await stale(order.id);
  const beforeStock = await stock();
  await Promise.all([sweepOnce({ staleAfterMs: 0 }), sweepOnce({ staleAfterMs: 0 })]);
  const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { paymentAttempts: true } });
  assert.equal(saved.status, "PAID");
  assert.equal(saved.paymentReference, found.reference);
  assert.equal(saved.paymentAttempts[0]?.status, "APPROVED");
  assert.equal(saved.paymentAttempts[0]?.reference, found.reference);
  assert.equal(await stock(), beforeStock);
});

test("timeout keeps stock reserved until settlement", async () => {
  const response = await place(TEST_CARDS.slow);
  assert.equal(response.statusCode, 202);
  const order = response.json();
  await stale(order.id);
  const description = chargeDescription(order.id);
  assert.deepEqual(await mockPaymentProvider.findChargeByDescription(description), { status: "unknown" });
  const beforeStock = await stock();
  await sweepOnce({ staleAfterMs: 0 });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  assert.equal(await stock(), beforeStock);
  // Advance the mock settlement time instead of waiting 60 seconds.
  await prisma.mockCharge.update({ where: { description }, data: { availableAt: new Date(Date.now() - 1) } });
  await sweepOnce({ staleAfterMs: 0 });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
  assert.equal(await stock(), beforeStock);
});

test("missing charge keeps stock; confirmed decline releases it once", async () => {
  const response = await place(TEST_CARDS.unknown);
  const order = response.json();
  const description = chargeDescription(order.id);
  await prisma.mockCharge.delete({ where: { description } });
  await prisma.paymentAttempt.updateMany({ where: { orderId: order.id }, data: { status: "PENDING" } });
  await stale(order.id);
  const beforeStock = await stock();
  await sweepOnce({ staleAfterMs: 0 });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  assert.equal(await stock(), beforeStock);
  await mockPaymentProvider.charge({ cardNumber: TEST_CARDS.declined, amountCents: 1000, description });
  await Promise.all([sweepOnce({ staleAfterMs: 0 }), sweepOnce({ staleAfterMs: 0 })]);
  await sweepOnce({ staleAfterMs: 0 });
  const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { paymentAttempts: true } });
  assert.equal(saved.status, "PAYMENT_FAILED");
  assert.equal(saved.paymentAttempts[0]?.status, "DECLINED");
  assert.equal(await stock(), beforeStock + 1);
});

test("amount mismatch keeps the order pending", async () => {
  const response = await place(TEST_CARDS.unknown);
  const order = response.json();
  await stale(order.id);
  await prisma.mockCharge.update({ where: { description: chargeDescription(order.id) }, data: { amountCents: 2000 } });
  const beforeStock = await stock();
  const results = await sweepOnce({ staleAfterMs: 0 });
  assert.equal(results.find((r) => r.orderId === order.id)?.outcome, "failed");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PENDING_PAYMENT");
  assert.equal(await stock(), beforeStock);
});

test("order totals respect the database range before reserving or charging", async () => {
  const beforeStock = await stock();
  const beforeOrders = await prisma.order.count({ where: { customerId } });
  const beforeAttempts = await prisma.paymentAttempt.count({ where: { order: { customerId } } });
  const beforeCharges = await prisma.mockCharge.count();
  try {
    for (const { priceCents, items } of [
      { priceCents: 50_000, items: Array.from({ length: 50 }, () => ({ productId, quantity: 1000 })) },
      { priceCents: 1_073_741_824, items: [{ productId, quantity: 2 }] },
    ]) {
      await prisma.product.update({ where: { id: productId }, data: { priceCents } });
      const response = await app.inject({
        method: "POST",
        url: "/orders",
        headers: { "idempotency-key": randomUUID() },
        payload: { ...body(TEST_CARDS.approved), items },
      });
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().error.code, "ORDER_TOTAL_OUT_OF_RANGE");
      assert.equal(await stock(), beforeStock);
      assert.equal(await prisma.order.count({ where: { customerId } }), beforeOrders);
      assert.equal(await prisma.paymentAttempt.count({ where: { order: { customerId } } }), beforeAttempts);
      assert.equal(await prisma.mockCharge.count(), beforeCharges);
    }
    await prisma.product.update({ where: { id: productId }, data: { priceCents: 2_147_483_647 } });
    const response = await place(TEST_CARDS.approved);
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().totalCents, 2_147_483_647);
    assert.equal(await stock(), beforeStock - 1);
  } finally {
    await prisma.product.update({ where: { id: productId }, data: { priceCents: 1000 } });
  }
});

test("lookup times out when the provider ignores cancellation", async () => {
  const provider = withChargeTimeout(
    {
      charge: async () => ({ status: "unknown" }),
      findChargeByDescription: async () => new Promise(() => {}),
    },
    20,
  );
  // AbortSignal.timeout is unref'd; keep the test alive while waiting.
  const timer = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(provider.findChargeByDescription("hung"));
  } finally {
    clearTimeout(timer);
  }
});
