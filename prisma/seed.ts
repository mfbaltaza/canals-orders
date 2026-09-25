import { prisma } from "../db.ts";

// Uneven on purpose so each scenario is demonstrable (NYC test address ≈ EAST):
// - EAST has no SKU-005 row at all → an NYC order with SKU-005 must go to CENTRAL
// - SKU-004 has 2 units everywhere → 3 × SKU-004 is impossible → 409

// Re-running the seed deletes all orders and resets stock, so every run starts clean.
// Orders are never seeded: they must come from POST /orders.

const customers = [
  { email: "juan@example.com", name: "Juan" },
  { email: "maricel@example.com", name: "Maricel" },
];

const products = [
  { sku: "SKU-001", name: "Product 1", priceCents: 1000 },
  { sku: "SKU-002", name: "Product 2", priceCents: 2000 },
  { sku: "SKU-003", name: "Product 3", priceCents: 3000 },
  { sku: "SKU-004", name: "Product 4", priceCents: 4000 },
  { sku: "SKU-005", name: "Product 5", priceCents: 5000 },
];

const warehouses = [
  { code: "EAST", name: "East (New York)", lat: 40.7128, lng: -74.006 },
  { code: "CENTRAL", name: "Central (Chicago)", lat: 41.8781, lng: -87.6298 },
  { code: "WEST", name: "West (Los Angeles)", lat: 34.0522, lng: -118.2437 },
];

// warehouse code → sku → quantity. A missing sku means "this warehouse doesn't stock it".
const stock: Record<string, Record<string, number>> = {
  EAST: { "SKU-001": 50, "SKU-002": 50, "SKU-003": 10, "SKU-004": 2 },
  CENTRAL: { "SKU-001": 50, "SKU-002": 50, "SKU-003": 50, "SKU-004": 2, "SKU-005": 20 },
  WEST: { "SKU-001": 100, "SKU-002": 100, "SKU-003": 100, "SKU-004": 2, "SKU-005": 100 },
};

async function main() {
  // Orders first: stock is reset below, and old orders would no longer match it.
  // OrderItem rows go with them (onDelete: Cascade).
  const { count: deletedOrders } = await prisma.order.deleteMany();

  // Remove customers that are no longer in the list (possible now that their orders are gone)
  await prisma.customer.deleteMany({ where: { email: { notIn: customers.map((c) => c.email) } } });

  for (const c of customers) {
    await prisma.customer.upsert({ where: { email: c.email }, update: { name: c.name }, create: c });
  }

  const productIdBySku = new Map<string, string>();
  for (const p of products) {
    const row = await prisma.product.upsert({ where: { sku: p.sku }, update: p, create: p });
    productIdBySku.set(p.sku, row.id);
  }

  for (const w of warehouses) {
    const wh = await prisma.warehouse.upsert({ where: { code: w.code }, update: w, create: w });
    const levels = stock[w.code] ?? {};

    for (const [sku, productId] of productIdBySku) {
      const quantity = levels[sku];

      if (quantity === undefined) {
        // Not stocked here: remove any row left over from an earlier seed
        await prisma.inventory.deleteMany({ where: { warehouseId: wh.id, productId } });
      } else {
        await prisma.inventory.upsert({
          where: { warehouseId_productId: { warehouseId: wh.id, productId } },
          update: { quantity },
          create: { warehouseId: wh.id, productId, quantity },
        });
      }
    }
  }

  console.log(
    `Deleted ${deletedOrders} orders. Seeded ${customers.length} customers, ${products.length} products, ${warehouses.length} warehouses`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
