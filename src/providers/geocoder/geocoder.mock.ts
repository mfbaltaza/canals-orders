import type { Coordinates } from "../../lib/geo.ts";
import type { Geocoder } from "./geocoder.provider.ts";

// Each warehouse is the closest one for at least one of these
const KNOWN_POSTAL_CODES: Record<string, Coordinates> = {
  "10118": { lat: 40.7484, lng: -73.9857 }, // New York, NY → EAST
  "02108": { lat: 42.3576, lng: -71.0636 }, // Boston, MA → EAST
  "60601": { lat: 41.8864, lng: -87.6186 }, // Chicago, IL → CENTRAL
  "80202": { lat: 39.7527, lng: -104.9994 }, // Denver, CO → WEST (1335 km vs 1478 km to CENTRAL)
  "90012": { lat: 34.0614, lng: -118.2385 }, // Los Angeles, CA → WEST
  "98101": { lat: 47.6101, lng: -122.3344 }, // Seattle, WA → WEST
};

export const mockGeocoder: Geocoder = {
  async geocode(address) {
    if (address.country !== "US") return null;
    return KNOWN_POSTAL_CODES[address.postalCode] ?? null;
  },
};
