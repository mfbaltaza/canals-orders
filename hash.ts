import { createHash } from "node:crypto";

// JSON with object keys sorted at every level, so { a, b } and { b, a } give the same string.
// Array order is kept: [x, y] and [y, x] are different values (sort them first if order doesn't matter)
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined) // JSON.stringify drops undefined fields too
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Fingerprint of a request body, stored next to the idempotency key (Layer 7, compared in Layer 11).
// Never pass anything secret: a sha256 of a card number can be brute-forced, so leave it out
export function hashRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
