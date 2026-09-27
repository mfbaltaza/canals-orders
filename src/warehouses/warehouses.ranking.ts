import { prisma } from "../db.ts";
import { type Coordinates, haversineKm } from "../lib/geo.ts";

type RequestedItem = { productId: string; quantity: number };

export async function rankWarehouses(dest: Coordinates, items: RequestedItem[]) {
  const productIds = items.map((p) => p.productId);
  const stock = await prisma.inventory.findMany({
    where: { productId: { in: productIds } },
    include: { warehouse: true },
  });

  const stockByWarehouse = new Map<string, typeof stock>();

  for (const row of stock) {
    const pile = stockByWarehouse.get(row.warehouse.id) ?? [];
    pile.push(row);
    stockByWarehouse.set(row.warehouse.id, pile);
  }

  const candidates = [];

  for (const pile of stockByWarehouse.values()) {
    const hasEverything = items.every((item) => {
      return pile.some((row) => row.productId === item.productId && row.quantity >= item.quantity);
    });
    if (hasEverything) candidates.push(pile[0]?.warehouse);
  }

  const ranked = candidates
    .map((warehouse) => {
      if (warehouse === undefined) throw new Error("Warehouse doesn't exist");
      return {
        warehouse,
        distanceInKm: haversineKm(dest, warehouse),
      };
    })
    .sort((a, b) => a.distanceInKm - b.distanceInKm);

  return ranked;
}
