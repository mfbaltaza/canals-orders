import { z } from "zod";

const Id = z.string().trim().min(1);
export const IdempotencyKey = Id.max(255);

export const ShippingAddress = z.object({
  line1: z.string().trim().min(1),
  line2: z.string().trim().min(1).optional(),
  city: z.string().trim().min(1),
  region: z.string().trim().min(1),
  postalCode: z.string().trim().min(1),
  // ISO 3166-1 alpha-2, e.g. "US"
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Expected a 2-letter country code"),
});

const OrderItem = z.object({
  productId: Id,
  // Capped so quantity × priceCents stays far below the Int column's limit
  quantity: z.number().int().positive().max(1000),
});

export const CreateOrderBody = z.object({
  customerId: Id,
  shippingAddress: ShippingAddress,
  items: z
    .array(OrderItem)
    .min(1)
    .max(50)
    // D9: merge duplicate productIds, otherwise each line passes the stock check on its own
    // while the order as a whole oversells
    .transform((items) => {
      const merged = new Map<string, number>();
      for (const { productId, quantity } of items) {
        merged.set(productId, (merged.get(productId) ?? 0) + quantity);
      }
      return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
    }),
  payment: z.object({
    // Never log or store this. Zod issues don't echo input values, so a 400 can't leak it
    cardNumber: z.string().regex(/^\d{12,19}$/, "Expected 12–19 digits"),
  }),
});

export type CreateOrderInput = z.infer<typeof CreateOrderBody>;
