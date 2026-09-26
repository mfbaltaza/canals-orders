# Testing

Two scripts check the running API from the outside, like a client would. Both write real orders.

| Script | Command | What it proves |
|---|---|---|
| `scripts/api-checks.ts` | `npm run api-checks` | Every status code in the contract, one request per row, plus stock and replay checks |
| `scripts/concurrency.ts` | `npm run concurrency` | No overselling under parallel load, and one order per idempotency key under parallel retries |

Automated integration tests (Vitest against Docker Postgres) come later and cover what can't be triggered from outside, such as the `500` path.

## Running locally

```bash
npm run dev                                       # terminal 1: keep it visible
npm run api-checks -- --reseed                    # terminal 2: expect 20/20
npm run db:seed && npm run concurrency            # expect 6 × 201, 14 × 409, stock 0/0/0
npm run concurrency -- --same-key --sku SKU-001   # expect 1 order id, stock −1
```

- `--reseed` runs `npm run db:seed` first. **It deletes every order** in the database, and it only runs against a local `--base`.
- Reseed before the oversell run: `api-checks` takes EAST's two units of SKU-004, which would leave the concurrency test starting at 0/0/2 instead of 2/2/2.
- **Read the server log, not just the script output.** Look for `warn`/`error` lines. A response can look correct to the client while the server logs a double send.

## Running against a deployed server

Both scripts read ids and stock from `DATABASE_URL`, so it must point at the same database as the server under `--base`. A variable set in the shell overrides `.env`:

```bash
DATABASE_URL='<production url>' npm run api-checks -- --base https://canals-orders-production.up.railway.app --allow-remote
```

Non-local URLs are refused without `--allow-remote`, because every successful row creates an order. `--reseed` is never allowed with a remote `--base`.

## What `api-checks` covers

Ids are looked up by the seed's natural keys (`juan@example.com`, `SKU-001`, …), because cuids differ from one database to the next. The address is 350 5th Ave, New York (postal code 10118) unless the row says otherwise. Expected warehouses assume the seed's stock (see `prisma/seed.ts`).

| Request | Expected | Why |
|---|---|---|
| NYC 1 × SKU-001 + 1 × SKU-005 | `201 PAID CENTRAL` | EAST doesn't stock SKU-005, so the nearest warehouse with every item wins |
| NYC 2 × SKU-004 | `201 PAID EAST` | nearest warehouse with enough stock |
| LA (90012) 1 × SKU-001 | `201 PAID WEST` | distance ranking |
| NYC 3 × SKU-004 | `409 OUT_OF_STOCK` | no single warehouse holds 3 |
| NYC 2 × SKU-004 + 1 × SKU-004 | `409 OUT_OF_STOCK` | the schema merges duplicate lines into 3 × SKU-004 before any stock check |
| Postal code 99999 | `422 ADDRESS_NOT_FOUND` | geocoder can't place it |
| Country CA | `422 ADDRESS_NOT_FOUND` | US addresses only |
| Unknown customer | `404 CUSTOMER_NOT_FOUND` | |
| Unknown product id | `400 UNKNOWN_PRODUCTS` | |
| Empty body | `400 VALIDATION_FAILED` | Zod rejects it |
| Malformed JSON | `400 FST_ERR_CTP_INVALID_JSON_BODY` | Fastify's error, in our `{ error: { code, message } }` shape |
| No `Idempotency-Key` header | `400 IDEMPOTENCY_KEY_INVALID` | |
| Card that isn't a test card | `400 CARD_NOT_ACCEPTED` | the mock never accepts real card numbers |
| Declined card `4000000000000002` | `402 PAYMENT_FAILED EAST` | |
| ↳ stock of SKU-001 | unchanged | the reservation is released |
| ↳ same key again | `402`, same order id | a retry replays the result |
| Unknown outcome `4000000000000119` | `202 PENDING_PAYMENT EAST` | the card may have been charged |
| ↳ stock of SKU-001 | −1 | the reservation is kept until the outcome is known |
| Same key twice (`4242…`) | `201` + `201`, one order id | the second request replays the first |
| ↳ stock of SKU-001 | −1 | decremented once |

It exits with `0` when every row passes and `1` otherwise, so it can gate a deploy.

**Not covered by this script:**

| Code | Where it's checked |
|---|---|
| `503 SERVICE_BUSY` + `Retry-After: 1` | needs load: `npm run concurrency -- --n 50` usually produces some |
| `500 INTERNAL_ERROR` | can't be triggered from outside; planned integration tests |

## What `concurrency` covers

It fires N identical orders at the same moment (default 20 × 1 unit of SKU-004 from New York), then compares stock before and after.

| Mode | Command | Passes when |
|---|---|---|
| Oversell | `npm run concurrency` | no warehouse below 0, units taken = successful orders × qty, successes ≤ what stock allows, the fallback filled every possible order, everything else is `409` or `503` |
| Same key | `npm run concurrency -- --same-key --sku SKU-001` | every response carries the same order id, every response is `201`/`202`/`503`, stock taken once |

Options: `--n 50`, `--qty 2`, `--sku SKU-001`, `--postal 90012`, `--base … --allow-remote`.

`503` responses count as "busy", not failures: under heavy load the database can't start every transaction within 2 s, nothing is written, and the client should retry with the same key.

## Results log

| Date | Target | Script | Result |
|---|---|---|---|
| 2026-09-26 | production | Layer 7 checks by hand | ✅ 400 missing / 256-char key, 400 malformed JSON, 400 non-test card, same key twice → one order id |
| 2026-09-26 | dev, not reseeded | `api-checks` | 17/20: the three misses were stock-dependent (SKU-004 at 0/0/0, EAST SKU-001 at 0). Server log: 0 warn/error |
| 2026-09-26 | dev, reseeded | `api-checks --reseed` | ✅ 20/20 |
| 2026-09-26 | dev, reseeded | `concurrency` (20 × 1 SKU-004) | ✅ all checks; database afterwards: SKU-004 0/0/0, 6 orders |
| 2026-09-26 | dev | `concurrency --same-key --sku SKU-001` | ✅ all checks; database afterwards: 1 order for the shared key, EAST SKU-001 50 → 49 |
