import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({
  adapter,
});

async function main() {
  await prisma.customer.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: { email: "alice@example.com", name: "Alice" },
  });

  const products = [];
  for (const p of [
    { sku: "SKU-001", name: "Product 1", priceCents: 1000 },
    { sku: "SKU-002", name: "Product 2", priceCents: 2000 },
    { sku: "SKU-003", name: "Product 3", priceCents: 3000 },
    { sku: "SKU-004", name: "Product 4", priceCents: 4000 },
    { sku: "SKU-005", name: "Product 5", priceCents: 5000 },
  ]) {
    products.push(
      await prisma.product.upsert({
        where: { sku: p.sku },
        update: {},
        create: p,
      }),
    );
  }

  // 3 warehouses — upsert on unique code
  const warehouses = [];
  for (const w of [
    { code: "EAST", name: "East", lat: 40.7, lng: -74.0 },
    { code: "CENTRAL", name: "Central", lat: 41.8, lng: -87.6 },
    { code: "WEST", name: "West", lat: 34.0, lng: -118.2 },
  ]) {
    warehouses.push(
      await prisma.warehouse.upsert({
        where: { code: w.code },
        update: {},
        create: w,
      }),
    );
  }

  // inventory — upsert on warehouseId+productId
  for (const wh of warehouses) {
    for (const prod of products) {
      await prisma.inventory.upsert({
        where: {
          warehouseId_productId: { warehouseId: wh.id, productId: prod.id },
        },
        update: { quantity: 100 },
        create: { warehouseId: wh.id, productId: prod.id, quantity: 100 },
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
