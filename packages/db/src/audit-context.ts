import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de auditoría por request/operación.
 *
 * Resuelve el "¿quién?" del audit log sin tener que pasar el actor a mano por
 * cada servicio. El middleware de la API abre el contexto con actor SYSTEM y
 * `requireAuth` lo eleva al médico autenticado una vez verificado el token.
 * Las operaciones de los crons corren fuera de cualquier request: ahí no hay
 * store y se usa DEFAULT_ACTOR (SYSTEM).
 */

export type ActorTypeValue = 'ADMIN' | 'DOCTOR' | 'SYSTEM' | 'BOT';

export interface AuditActor {
  actorType: ActorTypeValue;
  actorId: string | null; // doctorId para ADMIN/DOCTOR; null para SYSTEM/BOT
}

const auditContext = new AsyncLocalStorage<AuditActor>();

const DEFAULT_ACTOR: AuditActor = { actorType: 'SYSTEM', actorId: null };

/** Corre `fn` dentro de un contexto de actor. El store es mutable (ver setAuditActor). */
export function runWithAuditActor<T>(actor: AuditActor, fn: () => T): T {
  return auditContext.run(actor, fn);
}

/** Devuelve el actor del contexto actual, o SYSTEM si no hay (crons). */
export function getAuditActor(): AuditActor {
  return auditContext.getStore() ?? DEFAULT_ACTOR;
}

/**
 * Eleva el actor del contexto actual (ej: de SYSTEM a un médico) mutando el
 * store en su lugar para que el cambio se propague al resto de la cadena async
 * del request. No-op si no hay contexto abierto.
 */
export function setAuditActor(actor: AuditActor): void {
  const store = auditContext.getStore();
  if (store) {
    store.actorType = actor.actorType;
    store.actorId = actor.actorId;
  }
}
