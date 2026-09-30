export type ChargeRequest = {
  cardNumber: string;
  amountCents: number;
  description: string;
};

export type ChargeResult =
  | { status: "approved"; reference: string }
  | { status: "declined"; reason: string }
  // Timeout or lost response: the card may have been charged, so never treat this as declined
  | { status: "unknown" };

export type ChargeOptions = {
  signal?: AbortSignal | undefined;
};

export type ChargeLookupResult =
  | { status: "approved"; reference: string; amountCents: number }
  | { status: "declined"; reason: string; amountCents: number }
  | { status: "unknown" };

export interface PaymentProvider {
  charge(request: ChargeRequest, options?: ChargeOptions): Promise<ChargeResult>;
  findChargeByDescription(description: string, options?: ChargeOptions): Promise<ChargeLookupResult>;
}
