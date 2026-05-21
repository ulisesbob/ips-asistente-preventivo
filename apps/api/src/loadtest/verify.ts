/**
 * Lógica PURA de verificación del test de carga (Bloque B).
 *
 * Criterio de éxito del test de 40k: TODOS los recordatorios encolados terminan
 * `completed`, sin perdidos ni fallidos ni en vuelo. Es agnóstica del cron: mide
 * la integridad de la cola (lo que comparten los 5 crons migrados).
 *
 * El caller (scripts/loadtest/run.ts) debe pasar los conteos sumando `pgboss.job`
 * Y `pgboss.archive` (pg-boss archiva los completed tras un tiempo; sin contar el
 * archive, `completed` se vería artificialmente bajo y marcaría falsos "perdidos").
 */

export type QueueStateCounts = Partial<Record<string, number>>;

export interface VerifyResult {
  pass: boolean;
  enqueued: number;
  created: number;
  active: number;
  retry: number;
  completed: number;
  failed: number;
  /** Suma de todos los estados presentes en pgboss.job + archive. */
  total: number;
  /** Encolados que ya no aparecen en ningún estado (perdidos de verdad). */
  lost: number;
  reasons: string[];
}

export function evaluateQueueResult(
  enqueued: number,
  counts: QueueStateCounts
): VerifyResult {
  const created = counts.created ?? 0;
  const active = counts.active ?? 0;
  const retry = counts.retry ?? 0;
  const completed = counts.completed ?? 0;
  const failed = counts.failed ?? 0;
  // `total` suma TODOS los estados presentes (no una lista fija): así un estado no
  // enumerado (p.ej. `cancelled`) no se contabiliza erróneamente como "perdido".
  const total = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
  const lost = enqueued - total;

  const reasons: string[] = [];
  // Un test de carga que no encoló nada NO pasa (seed no corrido / flags mal / el
  // singletonKey dedupló todo de una corrida previa del mismo día).
  if (enqueued <= 0) {
    reasons.push('no se encoló ningún job (¿seed sin correr / flags / ya corrido hoy?)');
  }
  if (completed !== enqueued) {
    reasons.push(`completados (${completed}) != encolados (${enqueued})`);
  }
  if (failed > 0) {
    reasons.push(`${failed} jobs en estado failed`);
  }
  const unfinished = created + active + retry;
  if (unfinished > 0) {
    reasons.push(`${unfinished} jobs sin terminar (created/active/retry)`);
  }
  if (lost > 0) {
    reasons.push(`${lost} jobs perdidos (encolados - presentes en pgboss.job/archive)`);
  } else if (lost < 0) {
    reasons.push(
      `${-lost} jobs de MÁS vs encolados (contaminación de una corrida previa — correr cleanup antes)`
    );
  }

  return {
    pass: reasons.length === 0,
    enqueued,
    created,
    active,
    retry,
    completed,
    failed,
    total,
    lost,
    reasons,
  };
}
