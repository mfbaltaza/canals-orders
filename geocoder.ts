import type { Coordinates } from "./geo.ts";
import type { CreateOrderInput } from "./schemas.ts";

type Address = CreateOrderInput["shippingAddress"];

// D15: the route depends on this interface, so a real provider can replace the mock
export interface Geocoder {
  // null = the address can't be located; the route answers 422
  geocode(address: Address): Promise<Coordinates | null>;
}

// US postal code → coordinates. Picked so each warehouse is the closest for some address
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
