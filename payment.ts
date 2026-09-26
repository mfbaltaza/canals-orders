// D15: the route depends on this interface, so a real provider can replace the mock

export type ChargeRequest = {
  cardNumber: string;
  amountCents: number;
  // "Order <id>": lets a later reconciliation find this charge again (Layer 13)
  description: string;
};

export type ChargeResult =
  | { status: "approved"; reference: string }
  | { status: "declined"; reason: string }
  // Timeout or lost response: the card MAY have been charged. Never treat this as declined (D12)
  | { status: "unknown" };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

// The only card numbers the mock accepts. The demo is public, so it must never invite a real card:
// the route answers 400 for anything that isn't in this list (check with isTestCard before charging)
export const TEST_CARDS = {
  approved: "4242424242424242",
  declined: "4000000000000002",
  unknown: "4000000000000119",
} as const;

export function isTestCard(cardNumber: string): boolean {
  return Object.values<string>(TEST_CARDS).includes(cardNumber);
}

export const mockPaymentProvider: PaymentProvider = {
  async charge({ cardNumber, amountCents }) {
    // The route validates first, so reaching this is a bug in the caller, not bad user input
    if (!isTestCard(cardNumber)) throw new Error("mockPaymentProvider only accepts TEST_CARDS");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`Invalid amountCents: ${amountCents}`);

    switch (cardNumber) {
      case TEST_CARDS.declined:
        return { status: "declined", reason: "card_declined" };
      case TEST_CARDS.unknown:
        return { status: "unknown" };
      default:
        return { status: "approved", reference: `ch_mock_${crypto.randomUUID()}` };
    }
  },
};
