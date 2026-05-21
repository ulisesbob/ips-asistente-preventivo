import type PgBoss from 'pg-boss';

/**
 * Profundidad de las colas por estado (Bloque B, T9 — observabilidad).
 *
 * Lo usa `/health/cron` cuando `QUEUE_ENABLED` para ver cuántos jobs hay
 * `created/active/retry/completed/failed/...` por cola. Sirve para el gate de cada
 * etapa ("encolados == completed+failed → cero descartes") y para alertar si una
 * cola se acumula.
 *
 * Usa `boss.getDb().executeSql()` (pool propio de pg-boss, tipado) con un GROUP BY
 * directo sobre `pgboss.job` — un solo round-trip para todas las colas, en vez de
 * N llamadas a `getQueueSize` (que además solo cuenta "antes de" un estado).
 */
export type QueueDepth = Record<string, Record<string, number>>;

export async function getQueueDepth(boss: PgBoss): Promise<QueueDepth> {
  const { rows } = await boss
    .getDb()
    .executeSql(
      'SELECT name, state, COUNT(*)::text AS count FROM pgboss.job GROUP BY name, state',
      []
    );

  const depth: QueueDepth = {};
  for (const row of rows as { name: string; state: string; count: string }[]) {
    if (!depth[row.name]) depth[row.name] = {};
    depth[row.name][row.state] = Number(row.count);
  }
  return depth;
}
