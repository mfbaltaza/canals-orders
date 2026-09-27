import { createHash } from "node:crypto";

// Object keys are sorted; array order is kept, so sort arrays whose order doesn't matter first
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

// Never hash secrets: a sha256 of a card number can be brute-forced
export function hashRequest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}
