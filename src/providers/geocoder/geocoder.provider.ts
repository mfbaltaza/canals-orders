import type { Coordinates } from "../../lib/geo.ts";

export type Address = {
  line1: string;
  line2?: string | undefined;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

export type GeocodeOptions = {
  signal?: AbortSignal | undefined;
};

export interface Geocoder {
  // null when the address can't be located; throws when the provider can't answer
  geocode(address: Address, options?: GeocodeOptions): Promise<Coordinates | null>;
}

export class GeocoderUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeocoderUnavailable";
  }
}
