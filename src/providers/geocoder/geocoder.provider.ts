import type { Coordinates } from "../../lib/geo.ts";

export type Address = {
  line1: string;
  line2?: string | undefined;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export interface Geocoder {
  // null when the address can't be located
  geocode(address: Address): Promise<Coordinates | null>;
}
