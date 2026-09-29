import { env } from "../env.ts";
import { mockGeocoder } from "./geocoder/geocoder.mock.ts";
import type { Geocoder } from "./geocoder/geocoder.provider.ts";
import { withCache, withTimeout } from "./geocoder/geocoder.resilience.ts";
import { mockPaymentProvider } from "./payment/payment.mock.ts";
import type { PaymentProvider } from "./payment/payment.provider.ts";
import { withChargeTimeout } from "./payment/payment.resilience.ts";

export const paymentProvider: PaymentProvider = withChargeTimeout(mockPaymentProvider, env.PAYMENT_TIMEOUT_MS);

export const geocoder: Geocoder = withCache(withTimeout(mockGeocoder, env.GEOCODER_TIMEOUT_MS), {
  maxEntries: 1_000,
  ttlMs: 24 * 60 * 60 * 1000,
  notFoundTtlMs: 5 * 60 * 1000,
});
