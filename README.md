# canals-orders

`POST /orders` for an order management API.

**Live:** https://canals-orders-production.up.railway.app  
**Test it over!** https://canals-orders-demo.netlify.app/

Stack: Node ≥ 22.18 (runs `.ts` directly), Fastify 5, Prisma 7, Postgres, Zod 4.

## Quick start

Needs Node ≥ 22.18 (24 pinned in `.node-version`) and Docker.

```bash
npm ci                    # also runs prisma generate
cp .env.example .env      # points at the local Docker Postgres
npm run db:up             # Postgres 16 on :5432
npm run db:deploy         # apply migrations
npm run db:seed           # customers, products, warehouses, stock (deletes all orders)
npm run dev               # http://localhost:3000
```

### Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Pooled URL on hosts like Neon; validated at boot (`src/env.ts`) |
| `DIRECT_URL` | only with a pooler | `DATABASE_URL` | Non-pooled URL, used by migrations |
| `HOST` | no | `127.0.0.1` | Set `0.0.0.0` in containers and on the host |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` | |
| `RATE_LIMIT_MAX` | no | `10` in production, else off | Requests per minute per IP on `POST /orders`; `0` turns it off |
| `TRUST_PROXY` | no | `true` in production, else `false` | Take the client IP from `X-Forwarded-For`; only behind a trusted proxy |
| `CORS_ORIGINS` | no | none | Comma-separated browser origins allowed to call the API |
| `GEOCODER_TIMEOUT_MS` | no | `2000` | After this, the order gets `503 GEOCODER_UNAVAILABLE` |

## Try it

Against the live service, or `http://localhost:3000` after the quick start:

```bash
BASE=https://canals-orders-production.up.railway.app
KEY=$(uuidgen)   # one key per checkout attempt; reuse it to retry
```

No `uuidgen` any unique string of 1–255 characters works: `KEY=test-1`, then `test-2`.

**1. Place an order.** Juan orders one `prod_001`, shipped to New York:

```bash
curl -i $BASE/orders \
  -H 'content-type: application/json' \
  -H "idempotency-key: $KEY" \
  -d '{
    "customerId": "cus_juan",
    "shippingAddress": { "line1": "350 5th Ave", "city": "New York", "region": "NY", "postalCode": "10118", "country": "US" },
    "items": [{ "productId": "prod_001", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
```

→ `201`, `"status": "PAID"`, `"warehouseId": "wh_east"` (the nearest warehouse with stock).

**2. Retry it.** Run the same command again, with the same `$KEY`: → `201` with the **same order `id`**. The card isn't charged again and stock isn't taken twice.

**3. Vary one thing** (with a new `KEY=$(uuidgen)` each time):

| Change | Result | Why |
|---|---|---|
| `"items": [{ "productId": "prod_005", "quantity": 1 }]` | `201`, `wh_central` | `wh_east` doesn't stock `prod_005`, so the next-closest warehouse ships it |
| `"postalCode": "90012"` (Los Angeles) | `201`, `wh_west` | nearest warehouse |
| `"items": [{ "productId": "prod_004", "quantity": 3 }]` | `409 OUT_OF_STOCK` | every warehouse holds only 2 |
| `"cardNumber": "4000000000000002"` | `402`, `PAYMENT_FAILED` | declined; the reserved stock is released |
| `"postalCode": "99999"` | `422 ADDRESS_NOT_FOUND` | the geocoder can't place it |

**4. Prove it doesn't oversell** (local only: the script reads stock straight from the database). Twenty orders for `prod_004` arrive at the same moment, and only 6 units exist (2 per warehouse). With `npm run dev` running:

```bash
npm run db:seed && npm run concurrency
```

Condensed output:

```
Responses:   201 × 6   409 × 14
Stock per warehouse:   EAST 2 → 0   CENTRAL 2 → 0   WEST 2 → 0
✅ No warehouse went below 0
✅ Stock taken (6) = successful orders × qty (6)
✅ Successful orders (6) ≤ what the stock allows (6)
✅ Fallback filled every possible order (6 = min(n − 0 busy, 6))
✅ Every other response is 409 or 503
```

`npm run concurrency -- --same-key --sku SKU-001` fires 20 retries of **one** order with one shared key instead: one order is created and stock drops by 1.

### Seed data

`npm run db:seed` resets everything to these fixtures and deletes all orders:

| Customers | Products | Warehouses |
|---|---|---|
| `cus_juan`, `cus_maricel` | `prod_001` … `prod_005` ($10 … $50) | `wh_east` (New York), `wh_central` (Chicago), `wh_west` (Los Angeles) |

Stock is deliberately uneven: `wh_east` has no `prod_005`, and each warehouse holds only 2 × `prod_004`, so stock-outs and the fallback are easy to see.

### Test cards

The payment mock only accepts these. Any other number gets `400` before any stock is touched, so the public demo never invites a real card.

| Card | Outcome |
|---|---|
| `4242424242424242` | approved → `201 PAID` |
| `4000000000000002` | declined → `402 PAYMENT_FAILED`, stock released |
| `4000000000000119` | outcome unknown (timeout) → `202 PENDING_PAYMENT`, stock kept reserved |

### Addresses

The geocoder is a mock. These US postal codes resolve to their real location: `10118` and `02108` (nearest: `wh_east`), `60601` (`wh_central`), `80202`, `90012` and `98101` (`wh_west`). Any other US ZIP resolves to the rough center of its region by first digit (`0`–`2` → `wh_east`, `3`–`7` → `wh_central`, `8`–`9` → `wh_west`), so your own address works. Non-US addresses and ZIPs USPS doesn't assign (like `99999`) → `422`.

Like the test cards, two postal codes make the mock misbehave: `00408` never answers (the request times out) and `00503` fails. Both return `503 GEOCODER_UNAVAILABLE`.

## API

`POST /orders`. Headers: `Idempotency-Key` (required, 1–255 chars, unique per customer).

| Case | Status | Body |
|---|---|---|
| Order created and paid | `201` | order |
| Same `Idempotency-Key` again | same as the original | the original order |
| Payment outcome unknown | `202` | order (`PENDING_PAYMENT`) |
| Invalid body / missing or invalid `Idempotency-Key` | `400` | error, `details` = field errors |
| Card isn't a test card | `400` | error |
| Unknown product id(s) | `400` | error, `details.unknownProductIds` |
| Payment declined | `402` | order (`PAYMENT_FAILED`) |
| Unknown customer | `404` | error |
| No single warehouse has every item | `409` | error |
| Address can't be geocoded | `422` | error |
| Too many orders from one IP (see `RATE_LIMIT_MAX`) | `429` + `Retry-After` | error; nothing written, retry after that many seconds |
| Database busy (no transaction within 2 s) | `503` + `Retry-After: 1` | error; nothing written, retry with the same key |
| Geocoder timed out or failed | `503` + `Retry-After: 1` | error; nothing written, retry with the same key |
| Anything unexpected | `500` | generic error, details only in the server log |

Every error has one shape: `{ "error": { "code": "OUT_OF_STOCK", "message": "…", "details": … } }`. Every response carries a `Request-Id` header that matches the server's log lines.

`GET /healthz` returns `200 { "status": "ok" }` when the database answers, `503` otherwise.

## How it works

## Decisions

- **The card is charged after the reservation commits, never inside the transaction.** A database write can be rolled back; a card charge can't. Committing first also frees the stock row right away, so when those were the last units, other orders go to a warehouse that has stock instead of waiting on a lock. Revisit: never.

- **Stock is reserved with a conditional decrement.** 
It prevents oversells. The formula and the check run in one statement, so Postgres re-reads the quantity at the moment of the write. If someone bought just before us, we update from their result, not from a stale read. We do this instead of read → check → write, which can sell items we don't have, and fails silently when requests overlap. Revisit: When a product's stock no longer fits in one row per warehouse (for example, split across shelves, or across buckets to speed up a hot SKU), so a check has to add up several rows. Then we'd need row locks (`SELECT … FOR UPDATE`) or `SERIALIZABLE`. `SET quantity = quantity - wanted WHERE quantity >= wanted`
- **An unknown payment outcome keeps the stock reserved.** After a timeout we might have charged the customer and just don't know yet, so the order stays `PENDING_PAYMENT` (`202`) with its stock reserved until it's reconciled (a sweeper is planned). Revisit with a real payment provider: use its tools, such as webhooks, to reconcile.
- **If a warehouse can't fill the order, it falls back to the next closest.** Between ranking the warehouses and reserving, the stock can change. Revisit if one order may ship from several warehouses.
- **The `Idempotency-Key` is required and unique per customer.** A repeated request maps to the order it already created, so nothing is charged twice. It's per customer, not global, because another customer could send the same key and get someone else's order back. Revisit: compare the request hash, so the same key with a different body is rejected.
- **Money is integer cents, and each order item keeps a copy of its price.** Cents avoid floating-point rounding (`0.1 + 0.2 !== 0.3`). The copy means that if a price changes later, the order still shows what the customer paid. Revisit when an order could pass $21.4M, the `INTEGER` limit, which would need a `BigInt` column.
- **Synchronous, not a queue + worker.** It's simpler, fits the assignment, and has fewer points of failure. The customer gets the final answer in one round trip. It stays correct under load, and retries are safe. Revisit for heavy traffic spikes, or a payment provider slow enough that checkout waits too long.
- **Postgres + Prisma.** The database enforces the rules app code could get wrong (the unique idempotency key, foreign keys, `CHECK (quantity >= 0)`) and runs the reservation as one transaction; Prisma gives typed queries from one schema. It can't declare CHECK constraints, so those are hand-written in the migration SQL.

## Checks

```bash
npm run typecheck && npm run lint
```

## Project layout

```
src/
  index.ts                      Fastify bootstrap, CORS, rate limit, error handler, graceful shutdown
  env.ts                        Validated environment
  db.ts                         Prisma client
  health/
    health.routes.ts            GET /healthz
  orders/
    orders.routes.ts            POST /orders, top to bottom
    orders.schemas.ts           Zod request schemas
    orders.errors.ts            Domain errors
  warehouses/
    warehouses.ranking.ts       Distance ranking of candidate warehouses
  providers/
    index.ts                    Picks the implementation behind each interface (mocks today)
    payment/
      payment.provider.ts       PaymentProvider interface
      payment.mock.ts           Mock + test cards
    geocoder/
      geocoder.provider.ts      Geocoder interface
      geocoder.mock.ts          Mock (any US ZIP) + test postal codes
      geocoder.resilience.ts    Timeout and cache around any geocoder
  lib/
    geo.ts                      Haversine distance
    hash.ts                     Request hash stored with the idempotency key
prisma/                         Schema, migrations (hand-written CHECK constraints), seed
scripts/concurrency.ts          Parallel-orders proof: no overselling, one order per idempotency key
docker/Dockerfile               App image (used by docker-compose.yml)
```
