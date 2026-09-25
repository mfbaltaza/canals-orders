import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.ts",
  },
  datasource: {
    // Migrations use a direct (non-pooled) connection. Neon's pooler (PgBouncer,
    // transaction mode) may run consecutive statements on different server
    // connections, so the session-level advisory lock `migrate` takes isn't
    // guaranteed to hold. It often works anyway; the direct URL makes it reliable.
    // Local Docker has no pooler, so DIRECT_URL can be omitted there.
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"]!,
  },
});
