/**
 * Harness 40k — CLEANUP (Bloque B).
 *
 * Borra TODOS los pacientes sintéticos (dni LIKE 'LOADTEST-%') y purga los jobs de
 * las colas de recordatorios en pg-boss (job + archive). Seguro para los reales:
 * el prefijo LOADTEST- nunca colisiona con un DNI real (numérico).
 *
 * Uso (en STAGING):
 *   npm run loadtest:cleanup
 *
 * NUNCA correr contra producción. Ver scripts/loadtest/README.md.
 */
import { prisma } from '@ips/db';
import { SYNTHETIC_DNI_PREFIX } from '../../src/loadtest/synthetic';

async function main() {
  console.log(`[cleanup] Borrando pacientes sintéticos (dni LIKE '${SYNTHETIC_DNI_PREFIX}%')...`);
  const del = await prisma.patient.deleteMany({
    where: { dni: { startsWith: SYNTHETIC_DNI_PREFIX } },
  });
  console.log(`[cleanup] Pacientes sintéticos borrados: ${del.count}`);

  // Purga de jobs de pg-boss (job + archive) de las colas de recordatorios. Raw SQL
  // para no depender de que las colas estén registradas. Tolerante si el schema
  // pgboss aún no existe (nunca se arrancó la cola en este entorno).
  for (const table of ['pgboss.job', 'pgboss.archive']) {
    try {
      const affected = await prisma.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE name LIKE 'reminders:%'`
      );
      console.log(`[cleanup] ${table}: ${affected} jobs purgados.`);
    } catch (err) {
      console.warn(`[cleanup] no pude purgar ${table}: ${(err as Error).message}`);
    }
  }

  console.log('[cleanup] LISTO.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[cleanup] Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
