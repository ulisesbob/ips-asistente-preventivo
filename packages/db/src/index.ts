import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';
import { createAuditedClient } from './audit-extension';

/**
 * Construye el cliente Prisma con dos extensiones encadenadas:
 *  1. audit-log (interno): registra QUIÉN/QUÉ/CUÁNDO de cada escritura sensible.
 *  2. field-encryption (externo): cifra/descifra los campos marcados con
 *     `/// @encrypted` en el schema usando PRISMA_FIELD_ENCRYPTION_KEY.
 *
 * El orden importa: field-encryption envuelve al audit, así cifra los args antes
 * de la DB y descifra los results después. El audit solo lee nombres de campos e
 * ids (nunca valores), así que es indiferente al cifrado.
 */
function createPrismaClient() {
  const base = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Support 500+ concurrent patients: increase pool from default 5 to 20
    // by appending ?connection_limit=20 to DATABASE_URL.
  });
  return createAuditedClient(base).$extends(fieldEncryptionExtension());
}

type ExtendedPrisma = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as { prisma?: ExtendedPrisma };

export const prisma: ExtendedPrisma = globalForPrisma.prisma ?? createPrismaClient();

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
