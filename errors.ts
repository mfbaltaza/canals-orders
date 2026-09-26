// Domain errors: thrown by the order flow, turned into HTTP responses by the route.
// Plain fields, no constructor parameter properties: Node's type stripping can't run them (D17)

// A warehouse no longer has enough of an item. Thrown inside a reservation transaction,
// so throwing it also rolls back that warehouse's attempt; the route then tries the next one
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
