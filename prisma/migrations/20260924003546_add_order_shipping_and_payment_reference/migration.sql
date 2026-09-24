/*
  Warnings:

  - A unique constraint covering the columns `[paymentReference]` on the table `Order` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `shippingAddress` to the `Order` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "shippingAddress" JSONB NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Order_paymentReference_key" ON "Order"("paymentReference");
