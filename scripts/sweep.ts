// One sweeper pass by hand. The server runs the same pass on a timer (SWEEP_INTERVAL_MS).
//
//   npm run sweep                orders pending for over 10 minutes
//   npm run sweep -- --age 30
//
// Uses the database in .env, so point it at the server's database.
import { parseArgs } from "node:util";
import { prisma } from "../src/db.ts";
import { env, minStaleAfterMs } from "../src/env.ts";
import { sweepOnce } from "../src/orders/orders.sweep.ts";

const { values: args } = parseArgs({
  options: { age: { type: "string", default: "10" } },
});

const staleAfterMs = Number(args.age) * 60_000;
const minimum = minStaleAfterMs(env.PAYMENT_TIMEOUT_MS);
if (!Number.isFinite(staleAfterMs) || staleAfterMs < minimum) {
  console.error(`--age must be at least ${minimum / 60_000} minutes: younger orders may still be charging`);
  process.exit(1);
}

const results = await sweepOnce({ staleAfterMs });
for (const { orderId, attemptStatus, outcome, reference, error } of results) {
  console.log(`${orderId}  ${attemptStatus} → ${outcome}${reference ? `  ${reference}` : ""}`);
  if (error) console.error(error);
}
console.log(results.length ? `${results.length} stale orders` : "No stale orders");

await prisma.$disconnect();
process.exitCode = results.some((r) => r.outcome === "failed") ? 1 : 0;
