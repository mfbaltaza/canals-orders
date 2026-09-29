import { z } from "zod";

try {
  process.loadEnvFile();
} catch {
  // No .env file: deployed environments set real variables
}

// A minute on top of the charge timeout covers the database writes around the charge
export const minStaleAfterMs = (paymentTimeoutMs: number) => paymentTimeoutMs + 60_000;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    GEOCODER_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
    PAYMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    SWEEP_INTERVAL_MS: z.coerce.number().int().nonnegative().default(60_000),
    SWEEP_STALE_AFTER_MS: z.coerce.number().int().positive().default(600_000),
    RATE_LIMIT_MAX: z
      .string()
      .regex(/^\d+$/, "Expected a whole number, 0 turns rate limiting off")
      .transform(Number)
      .optional(),
    TRUST_PROXY: z.stringbool().optional(),
    CORS_ORIGINS: z
      .string()
      .default("")
      .transform((list) =>
        list
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url({ protocol: /^https?$/ }).transform((url) => new URL(url).origin))),
  })
  // Younger pending orders may still be waiting on their charge
  .refine((vars) => vars.SWEEP_STALE_AFTER_MS >= minStaleAfterMs(vars.PAYMENT_TIMEOUT_MS), {
    path: ["SWEEP_STALE_AFTER_MS"],
    message: "Must be at least PAYMENT_TIMEOUT_MS + 60000",
  })
  // Off locally so load scripts firing from one IP aren't throttled
  .transform((vars) => {
    const production = vars.NODE_ENV === "production";
    return {
      ...vars,
      RATE_LIMIT_MAX: vars.RATE_LIMIT_MAX ?? (production ? 10 : 0),
      TRUST_PROXY: vars.TRUST_PROXY ?? production,
    };
  });

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
