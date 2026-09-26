// Oversell test: fires N orders for the same product at the same moment, then checks the stock.
//
//   npm run concurrency                          20 × 1 unit of SKU-004 from New York
//   npm run concurrency -- --n 50 --qty 2
//   npm run concurrency -- --base https://… --allow-remote
//   npm run concurrency -- --same-key --sku SKU-001   idempotency: N retries of ONE order at once
//
// Stock is read from the database in .env, so run it against the server that uses the same database.
// Every request writes an order: reset with `npm run db:seed` between runs.
import { parseArgs } from "node:util";
import { prisma } from "../db.ts";
import { TEST_CARDS } from "../payment.ts";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    n: { type: "string", default: "20" },
    qty: { type: "string", default: "1" },
    sku: { type: "string", default: "SKU-004" },
    postal: { type: "string", default: "10118" },
    "allow-remote": { type: "boolean", default: false },
    // Every request sends the same Idempotency-Key: expect 1 order, 1 decrement, every response replaying it
    "same-key": { type: "boolean", default: false },
  },
});

const n = Number(args.n);
const qty = Number(args.qty);
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(args.base);
if (!isLocal && !args["allow-remote"]) {
  console.error(`Refusing to write ${n} orders to ${args.base}. Add --allow-remote if you mean it.`);
  process.exit(1);
}

const customer = await prisma.customer.findUniqueOrThrow({ where: { email: "juan@example.com" } });
const product = await prisma.product.findUniqueOrThrow({ where: { sku: args.sku } });

const readStock = async () => {
  const rows = await prisma.inventory.findMany({
    where: { productId: product.id },
    include: { warehouse: true },
    orderBy: { warehouse: { code: "asc" } },
  });
  return new Map(rows.map((r) => [r.warehouse.code, r.quantity]));
};

const before = await readStock();
// Most orders the stock can fill: each order needs `qty` units from ONE warehouse
const maxPossible = [...before.values()].reduce((sum, q) => sum + Math.floor(q / qty), 0);

const body = {
  customerId: customer.id,
  shippingAddress: { line1: "350 5th Ave", city: "New York", region: "NY", postalCode: args.postal, country: "US" },
  items: [{ productId: product.id, quantity: qty }],
  payment: { cardNumber: TEST_CARDS.approved },
};

const sameKey = args["same-key"];
const sharedKey = `concurrency-${crypto.randomUUID()}`;

console.log(`Firing ${n} × (${qty} × ${args.sku}) at ${args.base}${sameKey ? " with ONE shared key" : ""} …`);
const started = performance.now();
const responses = await Promise.all(
  Array.from(
    { length: n },
    () =>
      fetch(`${args.base}/orders`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": sameKey ? sharedKey : crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      })
        // A non-JSON body (e.g. a proxy's HTML 502) must not turn a real status into a fake network error
        .then(async (res) => ({
          status: res.status,
          id: ((await res.json().catch(() => ({}))) as { id?: string }).id,
        }))
        .catch(() => ({ status: 0, id: undefined })), // 0 = network error, no response
  ),
);
const statuses = responses.map((r) => r.status);
const ms = Math.round(performance.now() - started);

const after = await readStock();
await prisma.$disconnect();

const tally = new Map<number, number>();
for (const s of statuses) tally.set(s, (tally.get(s) ?? 0) + 1);
// 201 = paid, 202 = payment unknown: both keep their reservation. 402 gives the stock back
const reserved = (tally.get(201) ?? 0) + (tally.get(202) ?? 0);
// 503 = SERVICE_BUSY (P2028): the transaction never started, nothing written, safe to retry
const busy = tally.get(503) ?? 0;
const unitsTaken = [...before].reduce((sum, [code, q]) => sum + q - (after.get(code) ?? 0), 0);

console.log(`\nResponses in ${ms} ms:`);
console.table(Object.fromEntries([...tally].sort(([a], [b]) => a - b).map(([s, c]) => [s, { count: c }])));
console.log("Stock per warehouse:");
console.table(Object.fromEntries([...before].map(([code, q]) => [code, { before: q, after: after.get(code) }])));

const orderIds = new Set(responses.flatMap((r) => (r.id ? [r.id] : [])));

const oversellChecks = [
  { name: "No warehouse went below 0", ok: [...after.values()].every((q) => q >= 0) },
  {
    name: `Stock taken (${unitsTaken}) = successful orders × qty (${reserved * qty})`,
    ok: unitsTaken === reserved * qty,
  },
  { name: `Successful orders (${reserved}) ≤ what the stock allows (${maxPossible})`, ok: reserved <= maxPossible },
  {
    name: `Fallback filled every possible order (${reserved} = min(n − ${busy} busy, ${maxPossible}))`,
    ok: reserved === Math.min(n - busy, maxPossible),
  },
  {
    name: "Every other response is 409 or 503",
    ok: (tally.get(409) ?? 0) + busy === n - reserved - (tally.get(402) ?? 0),
  },
];

// One key = one attempt: the winner creates the order, every other request replays it (7b lookup or P2002)
const sameKeyChecks = [
  { name: `Every response carries the same order id (${orderIds.size} distinct)`, ok: orderIds.size === 1 },
  { name: `Every response is 201, 202 or 503 busy (${reserved} + ${busy} of ${n})`, ok: reserved + busy === n },
  { name: `Stock taken once (${unitsTaken} = qty ${qty})`, ok: unitsTaken === qty },
];

const checks = sameKey ? sameKeyChecks : oversellChecks;
for (const c of checks) console.log(`${c.ok ? "✅" : "❌"} ${c.name}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
