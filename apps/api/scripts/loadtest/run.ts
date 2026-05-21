/**
 * Harness 40k — RUN del test de carga del cron de followup (Bloque B).
 *
 * Arranca pg-boss, registra el worker de followup, ENCOLA todos los followups
 * pendientes (los pacientes sintéticos seedeados), espera a que la cola DRENE y
 * verifica la integridad: encolados == completados, 0 fallidos, 0 en vuelo, 0
 * perdidos (contando pgboss.job + pgboss.archive).
 *
 * SEGURIDAD: fuerza MOCK_TWILIO=true (NUNCA manda mensajes reales) antes de cargar
 * la config. Por eso usa imports DINÁMICOS (los estáticos se hoistean y la config
 * se parsearía antes de setear el env).
 *
 * Uso (en STAGING, con DATABASE_URL del staging):
 *   npm run loadtest:run
 * Tunables por env: SEND_RATE_PER_SEC, SEND_MAX_CONCURRENT, LOADTEST_TIMEOUT_MS.
 */

// ── Forzar env ANTES de cualquier import que lea la config ──────────────────────
process.env.MOCK_TWILIO = 'true'; // jamás mandar de verdad en el load test
process.env.QUEUE_ENABLED = process.env.QUEUE_ENABLED ?? 'true';
process.env.QUEUE_FOLLOWUP = process.env.QUEUE_FOLLOWUP ?? 'true';

const POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000; // 20 min

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { startBoss, stopBoss } = await import('../../src/queue/boss');
  const { registerQueueWorkers } = await import('../../src/queue/register-workers');
  const { enqueueFollowups } = await import('../../src/services/patient-followup.service');
  const { getQueueDepth } = await import('../../src/queue/queue-depth');
  const { QUEUE_NAMES } = await import('../../src/queue/queues');
  const { evaluateQueueResult } = await import('../../src/loadtest/verify');
  const { prisma } = await import('@ips/db');

  const timeoutMs = parseInt(process.env.LOADTEST_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS), 10);
  const queue = QUEUE_NAMES.followup;

  console.log('[run] Arrancando pg-boss + workers (MOCK_TWILIO=true)...');
  const boss = await startBoss();
  await registerQueueWorkers(boss);

  // Timestamp de la DB ANTES de encolar: el conteo final se acota a los jobs de
  // ESTA corrida (created_on >= startedAt). Sin esto, jobs completed de una corrida
  // previa (pg-boss los retiene ~12h en job y 7d en archive) contaminarían el
  // veredicto. Igual conviene correr `cleanup` antes (ver README).
  const startedAt = await dbNow(boss);

  console.log('[run] Encolando followups...');
  const t0 = Date.now();
  const { enqueued } = await enqueueFollowups(boss);
  console.log(`[run] Encolados: ${enqueued}. Esperando drenado...`);

  // Esperar a que no queden jobs en vuelo (created/active/retry) en la cola followup.
  const deadline = Date.now() + timeoutMs;
  let timedOut = false;
  for (;;) {
    const depth = await getQueueDepth(boss);
    const q = depth[queue] ?? {};
    const inFlight = (q.created ?? 0) + (q.active ?? 0) + (q.retry ?? 0);
    const completed = q.completed ?? 0;
    console.log(
      `[run] +${Math.round((Date.now() - t0) / 1000)}s  en vuelo=${inFlight} ` +
        `completed(job)=${completed} failed=${q.failed ?? 0}`
    );
    if (inFlight === 0) break;
    if (Date.now() > deadline) {
      console.error(`[run] TIMEOUT tras ${timeoutMs}ms con ${inFlight} jobs en vuelo.`);
      timedOut = true;
      break;
    }
    await sleep(POLL_MS);
  }

  const elapsedS = (Date.now() - t0) / 1000;
  const rate = elapsedS > 0 ? (enqueued / elapsedS).toFixed(0) : 'n/a';

  // Contar por estado (solo los de esta corrida) sumando pgboss.job + pgboss.archive.
  const counts = await countByState(boss, queue, startedAt);
  const result = evaluateQueueResult(enqueued, counts);
  const pass = result.pass && !timedOut;

  console.log('\n──────── RESULTADO DEL TEST DE CARGA ────────');
  console.log(`cola:        ${queue}`);
  console.log(`tiempo:      ${elapsedS.toFixed(1)}s  (~${rate} jobs/s)`);
  console.log(`encolados:   ${result.enqueued}`);
  console.log(`completados: ${result.completed}`);
  console.log(`fallidos:    ${result.failed}`);
  console.log(`en vuelo:    ${result.created + result.active + result.retry}`);
  console.log(`perdidos:    ${result.lost}`);
  if (timedOut) console.log('timeout:     ⏱️  SÍ (la cola no drenó dentro del límite)');
  console.log(`VEREDICTO:   ${pass ? '✅ PASA (0 perdidos)' : '❌ FALLA'}`);
  if (!pass) {
    result.reasons.forEach((r) => console.log(`  - ${r}`));
    if (timedOut) console.log('  - timeout: la cola no terminó de drenar (¿rate-limit muy bajo?)');
  }
  console.log('─────────────────────────────────────────────\n');

  await stopBoss({ wait: true });
  await prisma.$disconnect();
  process.exit(pass ? 0 : 1);
}

type BossDb = { getDb(): { executeSql(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> } };

/** Timestamp actual de la DB (para acotar el conteo a la corrida actual). */
async function dbNow(boss: BossDb): Promise<unknown> {
  const { rows } = await boss.getDb().executeSql('SELECT now() AS now', []);
  return (rows[0] as { now: unknown }).now;
}

/**
 * Suma conteos por estado de pgboss.job + pgboss.archive para una cola, acotado a
 * los jobs creados a partir de `since` (la corrida actual) — evita contar jobs de
 * corridas previas que pg-boss aún retiene.
 */
async function countByState(
  boss: BossDb,
  queue: string,
  since: unknown
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = ['pgboss.job', 'pgboss.archive'];
  for (const table of tables) {
    try {
      const { rows } = await boss
        .getDb()
        .executeSql(
          `SELECT state, COUNT(*)::int AS count FROM ${table} WHERE name = $1 AND created_on >= $2 GROUP BY state`,
          [queue, since]
        );
      for (const row of rows as { state: string; count: number }[]) {
        counts[row.state] = (counts[row.state] ?? 0) + Number(row.count);
      }
    } catch (err) {
      // pgboss.archive puede no existir según config — lo toleramos.
      console.warn(`[run] no pude leer ${table}: ${(err as Error).message}`);
    }
  }
  return counts;
}

main().catch((err) => {
  console.error('[run] Error:', err);
  process.exit(1);
});
