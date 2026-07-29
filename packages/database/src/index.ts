import { PrismaClient } from "@prisma/client";

const globalDatabase = globalThis as typeof globalThis & {
  fixnotePrisma?: PrismaClient;
};

export const prisma =
  globalDatabase.fixnotePrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalDatabase.fixnotePrisma = prisma;
}

export * from "@prisma/client";

