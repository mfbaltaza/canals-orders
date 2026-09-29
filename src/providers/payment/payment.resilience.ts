import { rejectOnAbort } from "../../lib/abort.ts";
import type { PaymentProvider } from "./payment.provider.ts";

export class ChargeTimedOut extends Error {
  constructor(timeoutMs: number) {
    super(`No answer from the payment provider within ${timeoutMs} ms`);
    this.name = "ChargeTimedOut";
  }
}

// The caller must treat a timeout as "unknown": the charge may still go through
export function withChargeTimeout(inner: PaymentProvider, timeoutMs: number): PaymentProvider {
  return {
    async charge(request, options) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      try {
        return await Promise.race([inner.charge(request, { signal }), rejectOnAbort(signal)]);
      } catch (err) {
        if (timeout.aborted) throw new ChargeTimedOut(timeoutMs);
        throw err;
      }
    },
    findChargeByDescription: (description) => inner.findChargeByDescription(description),
  };
}
