# canals-orders

`POST /orders` for an order management API.

**Live:** https://canals-orders-production.up.railway.app

Stack: Node 24+ (runs `.ts` directly), Fastify 5, Prisma 7, Postgres, Zod 4.

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

Ids are cuids, so look them up first (`npm run db:studio`, or the `Customer` / `Product` tables). The seed's fixtures:

| Customers | Products | Warehouses |
|---|---|---|
| `juan@example.com`, `maricel@example.com` | `SKU-001` … `SKU-005` ($10 … $50) | `EAST` (New York), `CENTRAL` (Chicago), `WEST` (Los Angeles) |

Stock is deliberately uneven: `EAST` has no `SKU-005`, and each warehouse holds only 2 × `SKU-004`, which makes stock-outs and the fallback easy to see.

```bash
curl -i http://localhost:3000/orders \
  -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{
    "customerId": "<juan id>",
    "shippingAddress": { "line1": "350 5th Ave", "city": "New York", "region": "NY", "postalCode": "10118", "country": "US" },
    "items": [{ "productId": "<SKU-001 id>", "quantity": 1 }],
    "payment": { "cardNumber": "4242424242424242" }
  }'
```

Send the same request you should get the same order back nothing is charged twice.

### Test cards

The payment mock only accepts these. Any other number gets `400` before any stock is touched, so the public demo never invites a real card.

| Card | Outcome |
|---|---|
| `4242424242424242` | approved → `201 PAID` |
| `4000000000000002` | declined → `402 PAYMENT_FAILED`, stock released |
| `4000000000000119` | outcome unknown (timeout) → `202 PENDING_PAYMENT`, stock kept reserved |

### Addresses

The geocoder is a mock that knows a handful of US postal codes: `10118` and `02108` (nearest: EAST), `60601` (CENTRAL), `80202`, `90012` and `98101` (WEST). Anything else → `422`.

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
