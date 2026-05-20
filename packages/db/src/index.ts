import { PrismaClient } from '@prisma/client';
import { createAuditedClient } from './audit-extension';

type AuditedClient = ReturnType<typeof createAuditedClient>;

const globalForPrisma = globalThis as unknown as { prisma?: AuditedClient };

export const prisma: AuditedClient =
  globalForPrisma.prisma ||
  createAuditedClient(
    new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Support 500+ concurrent patients: increase pool from default 5 to 20
      // by appending ?connection_limit=20 to DATABASE_URL.
    })
  );

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export * from '@prisma/client';

// Audit context helpers (trazabilidad ley 25.326).
export {
  runWithAuditActor,
  getAuditActor,
  setAuditActor,
} from './audit-context';
export type { AuditActor, ActorTypeValue } from './audit-context';
export {
  AUDITED_MODELS,
  shouldAudit,
  auditActionFor,
  extractRecordId,
  extractChangedFields,
} from './audit-extension';
