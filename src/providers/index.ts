import { mockGeocoder } from "./geocoder/geocoder.mock.ts";
import type { Geocoder } from "./geocoder/geocoder.provider.ts";
import { mockPaymentProvider } from "./payment/payment.mock.ts";
import type { PaymentProvider } from "./payment/payment.provider.ts";

export const paymentProvider: PaymentProvider = mockPaymentProvider;
export const geocoder: Geocoder = mockGeocoder;
