# canals-orders

`POST /orders` for an order management API.

**Live:** https://canals-orders-production.up.railway.app

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
| `DATABASE_URL` | yes | — | Pooled URL on hosts like Neon; validated at boot (`env.ts`) |
| `DIRECT_URL` | only with a pooler | `DATABASE_URL` | Non-pooled URL, used by migrations |
| `HOST` | no | `127.0.0.1` | Set `0.0.0.0` in containers and on the host |
| `PORT` | no | `3000` | |
| `LOG_LEVEL` | no | `info` | |

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

The geocoder is a mock that knows a handful of US postal codes: `10118` and `02108` (nearest: `wh_east`), `60601` (`wh_central`), `80202`, `90012` and `98101` (`wh_west`). Anything else → `422`.

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
| Database busy (no transaction within 2 s) | `503` + `Retry-After: 1` | error; nothing written, retry with the same key |
| Anything unexpected | `500` | generic error, details only in the server log |

Every error has one shape: `{ "error": { "code": "OUT_OF_STOCK", "message": "…", "details": … } }`.

## How it works

## Decisions

## Checks

```bash
npm run typecheck && npm run lint
```

## Project layout

```
index.ts          Fastify bootstrap, app-wide error handler
orders.ts         POST /orders, top to bottom
schemas.ts        Zod request schemas
env.ts            Validated environment
db.ts             Prisma client
warehouse.ts      Distance ranking of candidate warehouses
geo.ts            Haversine distance
geocoder.ts       Geocoder interface + mock
payment.ts        PaymentProvider interface + mock, test cards
hash.ts           Request hash stored with the idempotency key
errors.ts         Domain errors
prisma/           Schema, migrations (hand-written CHECK constraint), seed
```
