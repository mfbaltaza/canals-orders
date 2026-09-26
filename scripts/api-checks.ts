// API checks: one request per status-code row of the contract (PLAN.md §5), expected vs actual.
//
//   npm run api-checks                            against http://localhost:3000
//   npm run api-checks -- --reseed                reset the dev database first (DELETES every dev order)
//   DATABASE_URL=… npm run api-checks -- --base https://… --allow-remote
//
// Ids and stock are read from the database in DATABASE_URL (.env unless set in the shell),
// so it must be the database of the server under --base. Stock-dependent rows (2 × SKU-004 → EAST)
// assume the seed's stock: use --reseed on dev. Every 201/202/402 row writes a real order.
//
// Not covered here: 503 SERVICE_BUSY needs load (npm run concurrency -- --n 50),
// and 500 INTERNAL_ERROR can't be triggered from outside (Layer 16 integration tests).
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { prisma } from "../db.ts";
import { TEST_CARDS } from "../payment.ts";

const { values: args } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3000" },
    "allow-remote": { type: "boolean", default: false },
    reseed: { type: "boolean", default: false },
  },
});

const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(args.base);
if (!isLocal && !args["allow-remote"]) {
  console.error(`Refusing to write orders to ${args.base}. Add --allow-remote if you mean it.`);
  process.exit(1);
}
if (args.reseed) {
  // The seed wipes whatever DATABASE_URL points at: only ever for a local server
  if (!isLocal) {
    console.error("--reseed only runs with a local --base. Seed a remote database by hand if you mean it.");
    process.exit(1);
  }
  execSync("npm run db:seed", { stdio: "inherit" });
}

// Seeded fixtures by their stable natural keys: cuids differ between databases
const juan = await prisma.customer.findUniqueOrThrow({ where: { email: "juan@example.com" } });
const productRows = await prisma.product.findMany({ where: { sku: { in: ["SKU-001", "SKU-004", "SKU-005"] } } });
const sku = (code: string) => {
  const p = productRows.find((r) => r.sku === code);
  if (!p) throw new Error(`${code} not found: seed the database first (--reseed)`);
  return p.id;
};
const SKU1 = sku("SKU-001");
const SKU4 = sku("SKU-004");
const SKU5 = sku("SKU-005");
const warehouseCode = new Map((await prisma.warehouse.findMany()).map((w) => [w.id, w.code]));

const stockOf = async (productId: string) => {
  const rows = await prisma.inventory.findMany({ where: { productId } });
  return rows.reduce((sum, r) => sum + r.quantity, 0);
};

const address = (postalCode: string, country = "US") => ({
  line1: "350 5th Ave",
  city: "New York",
  region: "NY",
  postalCode,
  country,
});
const order = (items: { productId: string; quantity: number }[], opts: { postal?: string; card?: string } = {}) => ({
  customerId: juan.id,
  shippingAddress: address(opts.postal ?? "10118"),
  items,
  payment: { cardNumber: opts.card ?? TEST_CARDS.approved },
});

type Sent = { status: number; body: Record<string, unknown> };

// key: undefined → a fresh key, null → no header at all
const send = async (body: unknown, key: string | null = crypto.randomUUID()): Promise<Sent> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["idempotency-key"] = `api-checks-${key}`;
  const res = await fetch(`${args.base}/orders`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

// "409 OUT_OF_STOCK" for errors, "201 PAID EAST" for orders
const describe = ({ status, body }: Sent) => {
  const error = body.error as { code?: string } | undefined;
  if (error) return `${status} ${error.code}`;
  const where = warehouseCode.get(body.warehouseId as string) ?? "?";
  return `${status} ${body.status} ${where}`;
};

const results: { name: string; expected: string; actual: string; ok: boolean }[] = [];
const expect = (name: string, expected: string, actual: string) =>
  results.push({ name, expected, actual, ok: actual === expected });

// --- one request per row -----------------------------------------------------------------
const rows: [name: string, expected: string, body: unknown, key?: null][] = [
  [
    "NYC 1×001 + 1×005",
    "201 PAID CENTRAL",
    order([
      { productId: SKU1, quantity: 1 },
      { productId: SKU5, quantity: 1 },
    ]),
  ],
  ["NYC 2×004", "201 PAID EAST", order([{ productId: SKU4, quantity: 2 }])],
  ["LA 1×001", "201 PAID WEST", order([{ productId: SKU1, quantity: 1 }], { postal: "90012" })],
  ["NYC 3×004", "409 OUT_OF_STOCK", order([{ productId: SKU4, quantity: 3 }])],
  [
    "NYC 2×004 + 1×004 (D9)",
    "409 OUT_OF_STOCK",
    order([
      { productId: SKU4, quantity: 2 },
      { productId: SKU4, quantity: 1 },
    ]),
  ],
  ["Postal code 99999", "422 ADDRESS_NOT_FOUND", order([{ productId: SKU1, quantity: 1 }], { postal: "99999" })],
  [
    "Country CA",
    "422 ADDRESS_NOT_FOUND",
    { ...order([{ productId: SKU1, quantity: 1 }]), shippingAddress: address("10118", "CA") },
  ],
  ["Unknown customer", "404 CUSTOMER_NOT_FOUND", { ...order([{ productId: SKU1, quantity: 1 }]), customerId: "nope" }],
  ["Unknown product", "400 UNKNOWN_PRODUCTS", order([{ productId: "nope", quantity: 1 }])],
  ["Empty body", "400 VALIDATION_FAILED", { customerId: "" }],
  ["Malformed JSON", "400 FST_ERR_CTP_INVALID_JSON_BODY", "{bad"],
  ["No Idempotency-Key", "400 IDEMPOTENCY_KEY_INVALID", order([{ productId: SKU1, quantity: 1 }]), null],
  [
    "Card not a test card",
    "400 CARD_NOT_ACCEPTED",
    order([{ productId: SKU1, quantity: 1 }], { card: "4000000000009995" }),
  ],
];
for (const [name, expected, body, key] of rows) expect(name, expected, describe(await send(body, key)));

// --- rows that also check stock and replays ----------------------------------------------
// Declined: the reservation is released, and a retry with the same key replays the 402
{
  const key = crypto.randomUUID();
  const before = await stockOf(SKU1);
  const first = await send(order([{ productId: SKU1, quantity: 1 }], { card: TEST_CARDS.declined }), key);
  expect("Declined card …0002", "402 PAYMENT_FAILED EAST", describe(first));
  expect("  → stock of SKU-001 restored", "0", String((await stockOf(SKU1)) - before));
  const replay = await send(order([{ productId: SKU1, quantity: 1 }], { card: TEST_CARDS.declined }), key);
  expect("  → same key again: same order", `402 ${first.body.id}`, `${replay.status} ${replay.body.id}`);
}

// Unknown outcome: the card may be charged, so the reservation is kept (D12)
{
  const before = await stockOf(SKU1);
  expect(
    "Payment outcome unknown …0119",
    "202 PENDING_PAYMENT EAST",
    describe(await send(order([{ productId: SKU1, quantity: 1 }], { card: TEST_CARDS.unknown }))),
  );
  expect("  → stock of SKU-001 kept reserved", "-1", String((await stockOf(SKU1)) - before));
}

// Same key twice: one order, one decrement, the second response replays the first
{
  const key = crypto.randomUUID();
  const before = await stockOf(SKU1);
  const first = await send(order([{ productId: SKU1, quantity: 1 }]), key);
  const replay = await send(order([{ productId: SKU1, quantity: 1 }]), key);
  const orderIds = new Set([first.body.id, replay.body.id]).size;
  expect("Same key twice", "201 + 201, 1 order id", `${first.status} + ${replay.status}, ${orderIds} order id`);
  expect("  → stock of SKU-001 taken once", "-1", String((await stockOf(SKU1)) - before));
}

await prisma.$disconnect();

// --- report ------------------------------------------------------------------------------
const width = (pick: (r: (typeof results)[number]) => string, title: string) =>
  Math.max(title.length, ...results.map((r) => pick(r).length));
const w = [width((r) => r.name, "Request"), width((r) => r.expected, "Expected"), width((r) => r.actual, "Actual")];
const line = (a: string, b: string, c: string, mark = "") =>
  console.log(`${a.padEnd(w[0] ?? 0)} | ${b.padEnd(w[1] ?? 0)} | ${c.padEnd(w[2] ?? 0)} ${mark}`);

console.log(`\nAPI checks against ${args.base}\n`);
line("Request", "Expected", "Actual");
for (const r of results) line(r.name, r.expected, r.actual, r.ok ? "✅" : "❌");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed && !args.reseed) console.log("Stock-dependent rows assume a fresh seed: re-run with --reseed on dev.");
console.log(
  "Now check the server log for warn/error lines: the responses can look right while the server double-sends.",
);
process.exit(failed ? 1 : 0);
