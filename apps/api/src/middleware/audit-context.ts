import { Request, Response, NextFunction } from 'express';
import { runWithAuditActor } from '@ips/db';

/**
 * Abre el contexto de auditoría para cada request con actor SYSTEM por defecto.
 * `requireAuth` lo eleva al médico autenticado una vez verificado el token.
 * Debe registrarse ANTES del router para envolver toda la cadena de handlers.
 */
export function auditContextMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction
): void {
  runWithAuditActor({ actorType: 'SYSTEM', actorId: null }, () => next());
}
