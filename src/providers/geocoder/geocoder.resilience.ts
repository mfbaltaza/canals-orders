import type { Coordinates } from "../../lib/geo.ts";
import { type Address, type Geocoder, GeocoderUnavailable } from "./geocoder.provider.ts";

export function withTimeout(inner: Geocoder, timeoutMs: number): Geocoder {
  return {
    async geocode(address, options) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
      try {
        // Racing the signal too, in case the provider ignores it
        return await Promise.race([inner.geocode(address, { signal }), rejectOnAbort(signal)]);
      } catch (err) {
        const reason = timeout.aborted ? `no answer within ${timeoutMs} ms` : "provider error";
        throw new GeocoderUnavailable(`Geocoder unavailable: ${reason}`, { cause: err });
      }
    },
  };
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

type CacheOptions = {
  maxEntries: number;
  ttlMs: number;
  notFoundTtlMs: number;
};

type CacheEntry = { coordinates: Coordinates | null; expiresAt: number };

export function withCache(inner: Geocoder, { maxEntries, ttlMs, notFoundTtlMs }: CacheOptions): Geocoder {
  const entries = new Map<string, CacheEntry>();

  return {
    async geocode(address, options) {
      const key = cacheKey(address);
      const cached = entries.get(key);
      if (cached) {
        entries.delete(key);
        if (cached.expiresAt > Date.now()) {
          // Re-inserting moves the key to the end, so the first key is the least recently used
          entries.set(key, cached);
          return cached.coordinates;
        }
      }

      const coordinates = await inner.geocode(address, options);
      entries.set(key, { coordinates, expiresAt: Date.now() + (coordinates ? ttlMs : notFoundTtlMs) });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      return coordinates;
    },
  };
}

const normalize = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// Every field: two addresses in one ZIP can be far apart
function cacheKey(address: Address): string {
  const { country, postalCode, region, city, line1, line2 } = address;
  return JSON.stringify([country, postalCode, region, city, line1, line2].map(normalize));
}
