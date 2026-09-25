import { z } from "zod";

// Load .env if present (Node built-in, no dotenv at runtime).
// In Docker/production the variables come from the real environment instead.
try {
  process.loadEnvFile();
} catch {
  // no .env file: rely on process.env as-is
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // Pooled URL used by the app at runtime. Migrations use DIRECT_URL (see prisma7.config.ts).
  DATABASE_URL: z.url(),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // prettifyError prints paths and messages, never the values (the URL holds credentials)
  console.error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
