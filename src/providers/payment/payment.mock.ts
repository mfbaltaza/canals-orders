import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { prisma } from "../../db.ts";
import type { PaymentProvider } from "./payment.provider.ts";

// The demo is public, so only these numbers are accepted: the form must never invite a real card
export const TEST_CARDS = {
  approved: "4242424242424242",
  declined: "4000000000000002",
  unknown: "4000000000000119",
  slow: "4000000000009999",
} as const;

export function isTestCard(cardNumber: string): boolean {
  return Object.values<string>(TEST_CARDS).includes(cardNumber);
}

export const mockPaymentProvider: PaymentProvider = {
  async charge({ cardNumber, amountCents, description }, options) {
    options?.signal?.throwIfAborted();
    if (!isTestCard(cardNumber)) throw new Error("mockPaymentProvider only accepts TEST_CARDS");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error(`Invalid amountCents: ${amountCents}`);

    const declined = cardNumber === TEST_CARDS.declined;
    // Persist settlement time so an app restart cannot cancel the simulated payment.
    const charge = await prisma.mockCharge.upsert({
      where: { description },
      update: {},
      create: {
        description,
        amountCents,
        status: declined ? "DECLINED" : "APPROVED",
        reference: declined ? null : `ch_mock_${randomUUID()}`,
        declineReason: declined ? "card_declined" : null,
        availableAt: new Date(Date.now() + (cardNumber === TEST_CARDS.slow ? 60_000 : 0)),
      },
    });
    if (charge.amountCents !== amountCents) throw new Error("Charge key reused with a different amount");
    if (cardNumber === TEST_CARDS.unknown) return { status: "unknown" };

    const remainingMs = charge.availableAt.getTime() - Date.now();
    if (remainingMs > 0) await setTimeout(remainingMs, undefined, { signal: options?.signal });
    if (charge.status === "DECLINED") return { status: "declined", reason: charge.declineReason ?? "card_declined" };
    if (!charge.reference) throw new Error("Approved mock charge has no reference");
    return { status: "approved", reference: charge.reference };
  },

  async findChargeByDescription(description, options) {
    options?.signal?.throwIfAborted();
    const charge = await prisma.mockCharge.findUnique({ where: { description } });
    if (!charge || charge.availableAt.getTime() > Date.now()) return { status: "unknown" };
    if (charge.status === "DECLINED") {
      return { status: "declined", amountCents: charge.amountCents, reason: charge.declineReason ?? "card_declined" };
    }
    if (!charge.reference) throw new Error("Approved mock charge has no reference");
    return { status: "approved", amountCents: charge.amountCents, reference: charge.reference };
  },
};
