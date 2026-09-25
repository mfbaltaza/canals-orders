import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env.ts";
import { PrismaClient } from "./generated/prisma/client.ts";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
