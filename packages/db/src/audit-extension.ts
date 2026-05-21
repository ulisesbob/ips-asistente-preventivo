import { PrismaClient } from '@prisma/client';
import { getAuditActor } from './audit-context';

/**
 * Extensión de Prisma que escribe un registro de auditoría por cada escritura
 * sobre datos sensibles (ley 25.326 art. 9). Diseño:
 *  - Solo audita modelos sensibles (AUDITED_MODELS) y operaciones de escritura.
 *  - NO guarda valores de campos, solo sus nombres (no duplica PII en el log).
 *  - El audit se escribe con el cliente BASE (sin la extensión) para no recursar.
 *  - Es fire-and-forget: una falla del audit nunca rompe la operación de negocio.
 *
 * Helpers exportados como funciones puras para poder testearlos de verdad.
 */

export const AUDITED_MODELS = new Set<string>([
  'Patient',
  'PatientProgram',
  'PatientNote',
  'MedicationReminder',
  'PatientSelfReminder',
  'Doctor',
  'DoctorProgram',
  'Program',
  'Reminder',
  'Survey',
  'Conversation',
  'KnowledgeBase',
]);

const ACTION_BY_OP: Record<string, 'CREATE' | 'UPDATE' | 'DELETE' | undefined> = {
  create: 'CREATE',
  createMany: 'CREATE',
  update: 'UPDATE',
  updateMany: 'UPDATE',
  upsert: 'UPDATE',
  delete: 'DELETE',
  deleteMany: 'DELETE',
};

export function auditActionFor(operation: string): 'CREATE' | 'UPDATE' | 'DELETE' | null {
  return ACTION_BY_OP[operation] ?? null;
}

/** AuditLog se excluye siempre para no auditar el propio audit (anti-recursión). */
export function shouldAudit(model: string | undefined, operation: string): boolean {
  if (!model || model === 'AuditLog') return false;
  return AUDITED_MODELS.has(model) && auditActionFor(operation) !== null;
}

/** Id del registro afectado: del resultado si existe, si no del where.id. */
export function extractRecordId(args: unknown, result: unknown): string | null {
  if (result && typeof result === 'object' && 'id' in result) {
    const id = (result as { id: unknown }).id;
    if (typeof id === 'string') return id;
  }
  const where = (args as { where?: { id?: unknown } } | undefined)?.where;
  if (where && typeof where.id === 'string') return where.id;
  return null;
}

/** Nombres de campos tocados (SIN valores). delete/deleteMany no tienen campos. */
export function extractChangedFields(operation: string, args: unknown): string[] {
  const a = args as { data?: unknown; create?: object; update?: object } | undefined;
  if (operation === 'create' || operation === 'createMany') {
    const data = a?.data;
    if (Array.isArray(data)) return data.length ? Object.keys(data[0] as object) : [];
    return data ? Object.keys(data as object) : [];
  }
  if (operation === 'update' || operation === 'updateMany') {
    return a?.data ? Object.keys(a.data as object) : [];
  }
  if (operation === 'upsert') {
    const keys = new Set<string>();
    if (a?.create) Object.keys(a.create).forEach((k) => keys.add(k));
    if (a?.update) Object.keys(a.update).forEach((k) => keys.add(k));
    return [...keys];
  }
  return [];
}

/** Aplica la extensión de audit log a un PrismaClient base. */
export function createAuditedClient(base: PrismaClient) {
  return base.$extends({
    name: 'audit-log',
    query: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);

        if (shouldAudit(model, operation)) {
          const actor = getAuditActor();
          const action = auditActionFor(operation)!;
          const recordId = extractRecordId(args, result);
          const changedFields = extractChangedFields(operation, args);

          // Escrito con el cliente base (sin extensión) → no recursa.
          // Fire-and-forget: nunca debe tumbar la operación de negocio.
          void base.auditLog
            .create({
              data: {
                actorType: actor.actorType,
                actorId: actor.actorId,
                action,
                model: model!,
                recordId,
                changedFields,
              },
            })
            .catch((e: unknown) => {
              console.error('[AUDIT] failed to write audit log:', (e as Error)?.message);
            });
        }

        return result;
      },
    },
  });
}
