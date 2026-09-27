import { createHash } from "node:crypto";
import type { PaymentProvider } from "./payment.provider.ts";

// The demo is public, so only these numbers are accepted: the form must never invite a real card
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

  // No record of charges here, so the description decides: same order, same answer
  async findChargeByDescription(description) {
    const digest = createHash("sha256").update(description).digest();
    if (digest.readUInt8(0) % 2 === 1) return null;
    return { reference: `ch_mock_${digest.toString("hex").slice(0, 32)}` };
  },
};
