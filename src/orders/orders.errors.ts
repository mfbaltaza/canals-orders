export class OutOfStock extends Error {
  warehouseId: string;
  productId: string;

  constructor(warehouseId: string, productId: string) {
    super(`Warehouse ${warehouseId} has too little stock of product ${productId}`);
    this.name = "OutOfStock";
    this.warehouseId = warehouseId;
    this.productId = productId;
  }
}
