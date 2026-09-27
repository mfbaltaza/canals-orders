import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.ts",
  },
  datasource: {
    // Migrations need a non-pooled connection: a pooler can drop the advisory lock `migrate` holds
    // biome-ignore lint/style/noNonNullAssertion: the Prisma CLI fails loudly without it
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
