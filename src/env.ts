import { z } from "zod";

try {
  process.loadEnvFile();
} catch {
  // No .env file: deployed environments set real variables
}

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.url(),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    GEOCODER_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
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
