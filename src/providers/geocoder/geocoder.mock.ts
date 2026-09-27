import { setTimeout } from "node:timers/promises";
import type { Coordinates } from "../../lib/geo.ts";
import type { Geocoder } from "./geocoder.provider.ts";

// Like TEST_CARDS: these make the mock hang or fail, to show the 503
export const TEST_POSTAL_CODES = {
  notFound: "99999",
  slow: "00408",
  down: "00503",
} as const;

// Each warehouse is the closest one for at least one of these
const KNOWN_POSTAL_CODES: Record<string, Coordinates> = {
  "10118": { lat: 40.7484, lng: -73.9857 }, // New York, NY → EAST
  "02108": { lat: 42.3576, lng: -71.0636 }, // Boston, MA → EAST
  "60601": { lat: 41.8864, lng: -87.6186 }, // Chicago, IL → CENTRAL
  "80202": { lat: 39.7527, lng: -104.9994 }, // Denver, CO → WEST (1335 km vs 1478 km to CENTRAL)
  "90012": { lat: 34.0614, lng: -118.2385 }, // Los Angeles, CA → WEST
  "98101": { lat: 47.6101, lng: -122.3344 }, // Seattle, WA → WEST
};

const ZONE_CENTROIDS: Record<string, Coordinates> = {
  "0": { lat: 42.4, lng: -72.0 }, // New England, NJ → EAST
  "1": { lat: 41.5, lng: -76.0 }, // NY, PA, DE → EAST
  "2": { lat: 37.5, lng: -78.5 }, // DC, MD, VA, WV, NC, SC → EAST
  "3": { lat: 32.5, lng: -84.5 }, // FL, GA, AL, TN, MS → CENTRAL
  "4": { lat: 40.0, lng: -84.5 }, // OH, IN, KY, MI → CENTRAL
  "5": { lat: 45.5, lng: -95.0 }, // MN, WI, IA, the Dakotas, MT → CENTRAL
  "6": { lat: 39.5, lng: -93.0 }, // IL, MO, KS, NE → CENTRAL
  "7": { lat: 32.5, lng: -95.5 }, // TX, OK, AR, LA → CENTRAL
  "8": { lat: 39.5, lng: -111.0 }, // CO, UT, AZ, NM, NV, ID, WY → WEST
  "9": { lat: 38.5, lng: -121.0 }, // CA, OR, WA → WEST
};

const US_ZIP = /^(\d{5})(?:-\d{4})?$/;

// USPS assigns nothing outside this range, so 99999 stays unresolvable
const LOWEST_ZIP = 501;
const HIGHEST_ZIP = 99950;

export const mockGeocoder: Geocoder = {
  async geocode(address, options) {
    if (address.country !== "US") return null;

    const zip = US_ZIP.exec(address.postalCode)?.[1];
    if (zip === undefined) return null;

    if (zip === TEST_POSTAL_CODES.slow) {
      await setTimeout(60_000, undefined, { signal: options?.signal });
    }
    if (zip === TEST_POSTAL_CODES.down) throw new Error("mockGeocoder is down");

    const known = KNOWN_POSTAL_CODES[zip];
    if (known) return known;

    const zipNumber = Number(zip);
    if (zipNumber < LOWEST_ZIP || zipNumber > HIGHEST_ZIP) return null;
    return ZONE_CENTROIDS[zip.charAt(0)] ?? null;
  },
};
