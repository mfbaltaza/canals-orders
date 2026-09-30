import { prisma } from "../src/db.ts";

// Uneven on purpose so each scenario is demonstrable (NYC test address ≈ EAST):
// - EAST has no SKU-005 row at all → an NYC order with SKU-005 must go to CENTRAL
// - SKU-004 has 2 units everywhere → 3 × SKU-004 is impossible → 409

// Fixed ids so the README's curl examples work on any database
const customers = [
  { id: "cus_juan", email: "juan@example.com", name: "Juan" },
  { id: "cus_maricel", email: "maricel@example.com", name: "Maricel" },
];

const products = [
  { id: "prod_001", sku: "SKU-001", name: "Product 1", priceCents: 1000 },
  { id: "prod_002", sku: "SKU-002", name: "Product 2", priceCents: 2000 },
  { id: "prod_003", sku: "SKU-003", name: "Product 3", priceCents: 3000 },
  { id: "prod_004", sku: "SKU-004", name: "Product 4", priceCents: 4000 },
  { id: "prod_005", sku: "SKU-005", name: "Product 5", priceCents: 5000 },
];

const warehouses = [
  { id: "wh_east", code: "EAST", name: "East (New York)", lat: 40.7128, lng: -74.006 },
  { id: "wh_central", code: "CENTRAL", name: "Central (Chicago)", lat: 41.8781, lng: -87.6298 },
  { id: "wh_west", code: "WEST", name: "West (Los Angeles)", lat: 34.0522, lng: -118.2437 },
];

// A missing sku means the warehouse doesn't stock it
const stock: Record<string, Record<string, number>> = {
  EAST: { "SKU-001": 50, "SKU-002": 50, "SKU-003": 10, "SKU-004": 2 },
  CENTRAL: { "SKU-001": 50, "SKU-002": 50, "SKU-003": 50, "SKU-004": 2, "SKU-005": 20 },
  WEST: { "SKU-001": 100, "SKU-002": 100, "SKU-003": 100, "SKU-004": 2, "SKU-005": 100 },
};

const inventory = warehouses.flatMap((w) =>
  products
    .filter((p) => stock[w.code]?.[p.sku] !== undefined)
    .map((p) => ({ warehouseId: w.id, productId: p.id, quantity: stock[w.code]?.[p.sku] ?? 0 })),
);

async function main() {
  // Delete and recreate, not upsert: an upsert would keep an existing row's old id
  const deleted = await prisma.$transaction(
    async (tx) => {
      // Orders first: they reference everything else
      const orders = await tx.order.deleteMany();
      const charges = await tx.mockCharge.deleteMany();
      await tx.customer.deleteMany();
      await tx.product.deleteMany();
      await tx.warehouse.deleteMany();

      await tx.customer.createMany({ data: customers });
      await tx.product.createMany({ data: products });
      await tx.warehouse.createMany({ data: warehouses });
      await tx.inventory.createMany({ data: inventory });
      return { orders: orders.count, charges: charges.count };
    },
    { timeout: 30_000 },
  );

  console.log(
    `Deleted ${deleted.orders} orders and ${deleted.charges} mock charges. Seeded ${customers.length} customers, ${products.length} products, ${warehouses.length} warehouses, ${inventory.length} inventory rows`,
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
