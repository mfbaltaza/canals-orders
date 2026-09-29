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

export type FoundCharge = { reference: string };

export interface PaymentProvider {
  charge(request: ChargeRequest, options?: ChargeOptions): Promise<ChargeResult>;
  findChargeByDescription(description: string): Promise<FoundCharge | null>;
}
