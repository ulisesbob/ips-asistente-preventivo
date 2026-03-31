import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Support 500+ concurrent patients: increase pool from default 5 to 20
  // Prisma appends ?connection_limit=N to the URL automatically
  // For explicit control, add ?connection_limit=20 to DATABASE_URL
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';
