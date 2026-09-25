-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'EXPIRED');
ALTER TABLE "public"."Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';
COMMIT;

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_warehouseId_fkey";

-- DropIndex
DROP INDEX "Order_idempotencyKey_key";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "idempotencyRequestHash" TEXT NOT NULL,
ADD COLUMN     "shippingLat" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "shippingLng" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "warehouseId" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT',
ALTER COLUMN "idempotencyKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");

-- CreateIndex
CREATE INDEX "Order_warehouseId_idx" ON "Order"("warehouseId");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_customerId_idempotencyKey_key" ON "Order"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItem_orderId_productId_key" ON "OrderItem"("orderId", "productId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: Prisma's schema language can't express CHECK constraints.
-- The database is the last guard against overselling (D6), whatever the app code does.
ALTER TABLE "Inventory" ADD CONSTRAINT "inventory_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "orderitem_quantity_positive" CHECK ("quantity" > 0);
