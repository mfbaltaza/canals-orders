# canals-orders

`POST /orders` for an order management API.

**Live:** https://canals-orders-production.up.railway.app  
**Try it out!** https://canals-orders-demo.netlify.app/

Stack: Node ≥ 22.18 (runs `.ts` directly), Fastify 5, Prisma 7, Postgres, Zod 4.

## Quick start

Needs Docker:

```bash
docker compose up --build -d                     # Postgres, migrations, app on http://localhost:3000
docker compose run --rm migrate npm run db:seed  # fixtures; deletes all orders
```

Seed again whenever you want to reset orders and stock.

`GET /healthz` returns `200 { "status": "ok" }` when the database answers, `503` otherwise.

## Try it

Against the live service, or `http://localhost:3000` after the quick start:

```bash
BASE=https://canals-orders-production.up.railway.app
KEY=$(uuidgen)   # one key per checkout attempt; reuse it to retry
```

Any unique string of 1–255 characters works: `KEY=test-1`, then `test-2`.

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

→ `201`, `"status": "PAID"`, `"warehouseId": "wh_east"` (the nearest warehouse with stock). The response includes the purchased `items` with their quantities and price snapshots; retrying returns the same public shape.

**2. Retry it.** Run the same command again, with the same `$KEY`: → `201` with the **same order `id`**. The card isn't charged again and stock isn't taken twice.

**3. Vary one thing** (with a new `KEY=$(uuidgen)` each time):

| Change                                                  | Result                  | Why                                                                        |
| ------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `"items": [{ "productId": "prod_005", "quantity": 1 }]` | `201`, `wh_central`     | `wh_east` doesn't stock `prod_005`, so the next-closest warehouse ships it |
| `"postalCode": "90012"` (Los Angeles)                   | `201`, `wh_west`        | nearest warehouse                                                          |
| `"items": [{ "productId": "prod_004", "quantity": 3 }]` | `409 OUT_OF_STOCK`      | every warehouse holds only 2                                               |
| `"cardNumber": "4000000000000002"`                      | `402`, `PAYMENT_FAILED` | declined; the reserved stock is released                                   |
| `"postalCode": "99999"`                                 | `422 ADDRESS_NOT_FOUND` | the geocoder can't place it                                                |

**4. Prove it doesn't oversell** (local only: the script reads stock straight from the database). Twenty orders for `prod_004` arrive at the same moment, and only 6 units exist (2 per warehouse):

```bash
docker compose run --rm migrate sh -c "npm run db:seed && npm run concurrency -- --base http://app:3000"
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

Adding `--same-key --sku SKU-001` after `--base http://app:3000` fires 20 retries of **one** order with one shared key instead: one order is created and stock drops by 1.

### Seed data

Seeding resets everything to these fixtures and deletes all orders:

| Customers                 | Products                            | Warehouses                                                            |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| `cus_juan`, `cus_maricel` | `prod_001` … `prod_005` ($10 … $50) | `wh_east` (New York), `wh_central` (Chicago), `wh_west` (Los Angeles) |

Stock is deliberately uneven: `wh_east` has no `prod_005`, and each warehouse holds only 2 × `prod_004`, so stock-outs and the fallback are easy to see.

### Test cards

The payment mock only accepts these. Any other number gets `400` before any stock is touched, so the public demo never invites a real card.

| Card               | Outcome                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `4242424242424242` | approved → `201 PAID`                                                                      |
| `4000000000000002` | declined → `402 PAYMENT_FAILED`, stock released                                            |
| `4000000000000119` | approved, but the response is lost → `202 PENDING_PAYMENT`                                 |
| `4000000000009999` | no answer within `PAYMENT_TIMEOUT_MS` (10 s) → `202 PENDING_PAYMENT`, stock stays reserved |

Both `202` orders were charged, so the sweeper marks them `PAID` once they are `SWEEP_STALE_AFTER_MS` old (10 minutes by default). That's too slow to watch, so the tests in [Checks](#checks) prove it instead.

### Addresses

The geocoder is a mock. These US postal codes resolve to their real location: `10118` and `02108` (nearest: `wh_east`), `60601` (`wh_central`), `80202`, `90012` and `98101` (`wh_west`). Any other US ZIP resolves to the rough center of its region by first digit (`0`–`2` → `wh_east`, `3`–`7` → `wh_central`, `8`–`9` → `wh_west`), so your own address works. Non-US addresses and ZIPs USPS doesn't assign (like `99999`) → `422`.

Like the test cards, two postal codes make the mock misbehave: `00408` never answers (the request times out) and `00503` fails. Both return `503 GEOCODER_UNAVAILABLE`.

## How it works

1. We parse the `Idempotency-Key` header. If it's missing or invalid, we reject the request with a 400.
2. We validate the body against our schema, merging any repeated products into one line. If it isn't valid, we reject it with a 400.
3. We hash the body, without the payment part, as the request's fingerprint. The card never goes into the hash.
4. We build the order key from the `customerId` and the `Idempotency-Key`, and check whether that order already exists. If it does and its fingerprint matches, we return the stored order with the status code of its current state. If the fingerprint differs, the key was reused for a different order, and we return `422 IDEMPOTENCY_KEY_REUSED`.
5. We check that the card is one of the documented test cards. If it isn't, we reject it with a 400.
6. We look up the customer. If they don't exist, we return a 404.
7. We look up the products. If any of them is unknown, we reject the request with a 400.
8. We price every item from the database (never from the client), sort the items by product, and add up the total in cents.
9. We geocode the shipping address by using our mock service. If we can't find it, we return a 422. If the geocoder fails or doesn't answer within `GEOCODER_TIMEOUT_MS`, we return a 503.
10. We rank the warehouses that have every item, closest first. If none has stock, we check whether an earlier, possibly duplicate request with the same key took it; if so we return that order, otherwise a 409.
11. We try each warehouse in turn. In one transaction we take every item with a conditional decrement and create the order as `PENDING_PAYMENT` together with a `PENDING` payment attempt, so the sweeper never finds an order without one. If an item runs short, the transaction rolls back and we try the next warehouse. If a request with the same key committed first, we return its order. If every warehouse runs short, it's a 409.
12. With the stock reserved and committed, we charge the card for the total, with the order id as the description. We stop waiting after `PAYMENT_TIMEOUT_MS`.
13. Approved: we mark the order `PAID` and return 201. If saving that fails, we return 202, because the money has moved.
14. Declined: in one transaction we mark the order `PAYMENT_FAILED` and put the stock back, then return 402.
15. Unknown (the call timed out or failed): we leave the order `PENDING_PAYMENT` with its stock reserved and return 202.

**Stuck orders.** Every `SWEEP_INTERVAL_MS` (1 minute by default), a sweeper inside the app looks for orders that have been `PENDING_PAYMENT` for longer than `SWEEP_STALE_AFTER_MS` (10 minutes by default): the request crashed, or the provider never answered. It decides from the order's latest payment attempt: none → left pending for investigation, approved → `PAID`, declined → `PAYMENT_FAILED`, pending or unknown → it asks the provider for the charge by its description and checks the amount. A confirmed approval becomes `PAID`; a confirmed decline becomes `PAYMENT_FAILED` and its stock goes back in the same transaction. Missing records and unresolved payments stay pending with stock reserved. The payment attempt is updated together with the order. `npm run sweep` runs one pass by hand.

## Decisions

- **`Idempotency-Key` is required and must be unique per request.** A repeated request maps to the previous order, so nothing is charged twice. We check this per customer, not globally, because another customer could send the same key and get someone else's order back.

- **We charge the card outside the transaction.** It is way easier to roll back a database write; a card charge can't be rolled back quite as easily. Committing first frees the stock row right away, so when dealing with the last units, other orders can go to a warehouse that has stock straight away instead of waiting on a lock. I would revisit only if the provider supports authorize-then-capture inside our flow.

- **If a warehouse can't fill the order, it falls back to the next closest.** Between ranking the warehouses and reserving, the stock can change. This would need revisiting if one order may ship from several warehouses.

- **Money is integer cents, and each order item keeps a copy of its price.** Cents avoid floating-point rounding. The copy means that if a price changes later, the order still shows what the customer paid. Totals outside 1–2,147,483,647 cents return `422 ORDER_TOTAL_OUT_OF_RANGE` before stock is reserved or payment is called. Larger orders would need a `BigInt` column.

- **Fastify + Postgres + Prisma.** For the assignment I decided to go with this stack because Fastify provides a quick way to start a node project which is in line with the stack used at Canals. Also due to the assignment requiring the use of a real database, we went with Postgres + Prisma to take advantage of the typing and schema parsing abilities it provides.

- **Synchronous, not a queue + worker.** It's simpler, fits the assignment, and has fewer points of failure. The customer gets the final answer in one round trip. It stays correct under load, and retries are safe. I would revisit this selection for heavy traffic spikes, or a payment provider slow enough that checkout waits too long.

- **Stock is reserved with a conditional decrement: `SET quantity = quantity - wanted WHERE quantity >= wanted`.** This helps us prevent oversells. The formula and the check run in one statement, so Postgres re-reads the quantity at the moment of the write. If someone bought just before us, we would update from their result, not from a stale read. We do this instead of read -> check -> write, which can sell items we don't have, and fails silently when requests overlap. I would revisit this when a product's stock no longer fits in one row per warehouse (for example, split across shelves, or across buckets to speed up a hot SKU), because then we will need to add up several rows. Then we'd need row locks (`SELECT … FOR UPDATE`) or `SERIALIZABLE`.

- **Unknown payments keep their stock reserved.** The sweeper marks confirmed approvals `PAID` and releases stock only for definitive declines. It checks amounts and updates the order and payment attempt together. Status guards prevent double release. Missing records stay pending; safely expiring them requires cancellation or a way to prevent a paused request from charging later.

- **The mock has a durable provider ledger.** `MockCharge` stores outcomes independently of payment attempts. The unknown card simulates a lost approval response; the slow card settles after 60 seconds, including across app restarts. Descriptions are stable mock charge keys. A real integration would use the provider's idempotency and reconciliation APIs.

- **Payment calls and lookups have a 10-second timeout.** Stopping our wait does not cancel a charge. Timeout and unresolved lookup results keep the order pending; the charge is never automatically retried.

## Checks

```bash
docker compose run --rm migrate sh -c "npm run typecheck && npm run lint"
```

The tests run against a throwaway database, so they never touch your data:

```bash
docker compose run --rm --build test
docker compose rm -sf test-db   # remove the throwaway database
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
    orders.response.ts          Public order shape, shared by new orders and replays
    orders.errors.ts            Domain errors
    orders.charge.ts            Charge description, shared by the route and the sweeper
    orders.sweep.ts             Sweeper for orders stuck in PENDING_PAYMENT, runs on a timer
  warehouses/
    warehouses.ranking.ts       Distance ranking of candidate warehouses
  providers/
    index.ts                    Picks the implementation behind each interface (mocks today)
    payment/
      payment.provider.ts       PaymentProvider interface
      payment.mock.ts           Durable mock provider ledger + test cards
      payment.resilience.ts     Timeout around any payment provider
    geocoder/
      geocoder.provider.ts      Geocoder interface
      geocoder.mock.ts          Mock (any US ZIP) + test postal codes
      geocoder.resilience.ts    Timeout and cache around any geocoder
  lib/
    geo.ts                      Haversine distance
    hash.ts                     Request hash stored with the idempotency key
    abort.ts                    Reject when an AbortSignal fires
prisma/                         Schema, migrations (hand-written CHECK constraints), seed
scripts/concurrency.ts          Parallel-orders proof: no overselling, one order per idempotency key
scripts/sweep.ts                One sweeper pass by hand
tests/orders.test.ts            Payment recovery (replays, lost responses, timeouts, declines, amounts) and order total limits
docker/Dockerfile               App image (used by docker-compose.yml)
```

### Environment

| Variable               | Required           | Default                            | Notes                                                                                                           |
| ---------------------- | ------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | yes                | —                                  | Pooled URL on hosts like Neon; validated at boot (`src/env.ts`)                                                 |
| `DIRECT_URL`           | only with a pooler | `DATABASE_URL`                     | Non-pooled URL, used by migrations                                                                              |
| `HOST`                 | no                 | `127.0.0.1`                        | Set `0.0.0.0` in containers and on the host                                                                     |
| `PORT`                 | no                 | `3000`                             |                                                                                                                 |
| `LOG_LEVEL`            | no                 | `info`                             |                                                                                                                 |
| `RATE_LIMIT_MAX`       | no                 | `10` in production, else off       | Requests per minute per IP on `POST /orders`; `0` turns it off                                                  |
| `TRUST_PROXY`          | no                 | `true` in production, else `false` | Take the client IP from `X-Forwarded-For`; only behind a trusted proxy                                          |
| `CORS_ORIGINS`         | no                 | none                               | Comma-separated browser origins allowed to call the API                                                         |
| `GEOCODER_TIMEOUT_MS`  | no                 | `2000`                             | After this, the order gets `503 GEOCODER_UNAVAILABLE`                                                           |
| `PAYMENT_TIMEOUT_MS`   | no                 | `10000`                            | After this, the charge counts as unknown: `202 PENDING_PAYMENT`, never declined, never retried                  |
| `SWEEP_INTERVAL_MS`    | no                 | `60000`                            | How often the sweeper runs; `0` turns it off (`npm run sweep` runs one pass by hand)                            |
| `SWEEP_STALE_AFTER_MS` | no                 | `600000`                           | Only orders pending for longer are swept. Must be at least `PAYMENT_TIMEOUT_MS` + 60000, or the app won't start |

## Development

Needs Node ≥ 22.18 (24 pinned in `.node-version`). Postgres stays in Docker; stop the Docker app first (`docker compose stop app`) so port 3000 is free.

```bash
npm ci                    # also runs prisma generate
cp .env.example .env      # points at the Docker Postgres on :55432
npm run db:up && npm run db:deploy && npm run db:seed
npm run dev               # restarts on every change to a file the server imports
```

`.env` and `prisma/schema.prisma` aren't watched: after a schema change, run `npm run db:migrate`.
