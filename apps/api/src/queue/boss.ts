import PgBoss from 'pg-boss';
import { logger } from '../utils/logger';

/**
 * Singleton de pg-boss (Bloque B).
 *
 * INERTE por diseño: crear este módulo NO arranca nada. `getBoss()` sólo
 * construye la instancia (no abre conexiones); `startBoss()` recién corre el
 * `boss.start()` que crea/migra el schema `pgboss` y abre el pool. Ningún
 * entrypoint lo llama todavía (eso es T7+, bajo `QUEUE_ENABLED`).
 *
 * Decisiones:
 * - Usa `process.env.DATABASE_URL` CRUDA (no el cliente Prisma extendido):
 *   pg-boss mantiene su propio pool y crea su schema con DDL.
 * - Pool chico (`max: 4`) para no agotar las conexiones de Neon (Prisma usa el
 *   pooler aparte). Ver "Riesgos clave" del plan.
 * - `startBoss` es idempotente: una sola `start()` aunque se llame N veces o en
 *   paralelo (se memoiza la promesa en vuelo).
 */

let boss: PgBoss | null = null;
let startPromise: Promise<PgBoss> | null = null;

function buildBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // No debería pasar (env.ts ya valida DATABASE_URL), pero fallamos ruidoso
    // antes de que pg-boss intente conectar a undefined.
    throw new Error('DATABASE_URL no está definida — pg-boss no puede arrancar');
  }
  return new PgBoss({
    connectionString,
    max: 4,
  });
}

/**
 * Devuelve la instancia singleton de pg-boss, construyéndola la primera vez.
 * Construir NO conecta ni arranca: para eso está `startBoss()`.
 */
export function getBoss(): PgBoss {
  if (!boss) {
    boss = buildBoss();
    boss.on('error', (err) => {
      logger.error('pg-boss error', { event: 'queue', error: err instanceof Error ? err.message : String(err) });
    });
  }
  return boss;
}

/**
 * Arranca pg-boss (idempotente). Si ya está arrancando o arrancado, reutiliza
 * la misma promesa y NO vuelve a llamar `boss.start()`.
 */
export function startBoss(): Promise<PgBoss> {
  if (startPromise) return startPromise;

  const instance = getBoss();
  startPromise = instance
    .start()
    .then(() => {
      logger.info('pg-boss iniciado', { event: 'queue', action: 'start' });
      return instance;
    })
    .catch((err) => {
      // Si falla el arranque, reseteamos para permitir reintentar.
      startPromise = null;
      throw err;
    });

  return startPromise;
}

/**
 * Detiene pg-boss limpiamente y resetea el singleton para permitir un reinicio
 * posterior. `wait: true` (default) espera a que drenen los jobs en vuelo antes
 * de cerrar — clave en el shutdown de Render (SIGTERM) para no cortar envíos a
 * mitad. El arg se acepta para que el caller (index.ts) lo haga explícito.
 *
 * m1 (race SIGTERM rápido): si `start()` está EN VUELO cuando llega el stop
 * (Render manda SIGTERM apenas arranca el deploy), esperamos a que ese `start()`
 * termine ANTES de `stop()`. Sin esto, `stop()` podría correr a mitad del arranque
 * de pg-boss (schema/migraciones) y dejarlo en un estado inconsistente. Si el
 * `start()` en vuelo FALLA, lo absorbemos (catch) y cerramos igual: el objetivo
 * del stop es liberar recursos, no propagar el fallo de arranque.
 */
export async function stopBoss(opts: { wait?: boolean } = { wait: true }): Promise<void> {
  if (!boss) return;
  const instance = boss;
  // Capturamos la promesa de arranque en vuelo ANTES de resetear el singleton.
  const inFlightStart = startPromise;
  // Reseteamos para que un start concurrente cree una instancia nueva.
  boss = null;
  startPromise = null;
  // Esperar el start() en vuelo (si lo hay) antes de cerrar. Absorbemos su error:
  // un arranque fallido no debe impedir el cierre limpio.
  if (inFlightStart) {
    await inFlightStart.catch(() => undefined);
  }
  await instance.stop({ wait: opts.wait ?? true });
  logger.info('pg-boss detenido', { event: 'queue', action: 'stop' });
}
