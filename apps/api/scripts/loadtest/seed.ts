/**
 * Harness 40k — SEED de pacientes sintéticos (Bloque B).
 *
 * Crea N pacientes sintéticos candidatos al cron de followup (BOT-registrados, con
 * consent + whatsappLinked + phone + createdAt antiguo, SIN programas). Marcados por
 * convención de DNI (LOADTEST-*) para un cleanup seguro. NO toca los reales.
 *
 * Uso (en STAGING, con la DATABASE_URL del staging en el entorno):
 *   npm run loadtest:seed            # 40.000 (default)
 *   npm run loadtest:seed -- 1000    # N custom
 *
 * NUNCA correr contra la base de producción. Ver scripts/loadtest/README.md.
 */
import { prisma, RegisteredVia } from '@ips/db';
import { buildSyntheticPatient, SYNTHETIC_DNI_PREFIX } from '../../src/loadtest/synthetic';

const DEFAULT_N = 40_000;
const BATCH = 1_000;

async function main() {
  const n = parseInt(process.argv[2] ?? String(DEFAULT_N), 10);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`N inválido: ${process.argv[2]}`);
    process.exit(1);
  }

  console.log(`[seed] Creando ${n} pacientes sintéticos (prefijo DNI ${SYNTHETIC_DNI_PREFIX})...`);
  const now = new Date();
  let created = 0;

  for (let start = 0; start < n; start += BATCH) {
    const end = Math.min(start + BATCH, n);
    const rows = [];
    for (let i = start; i < end; i++) {
      const s = buildSyntheticPatient(i, now);
      rows.push({
        dni: s.dni,
        phone: s.phone,
        fullName: s.fullName,
        consent: s.consent,
        whatsappLinked: s.whatsappLinked,
        registeredVia: s.registeredVia as RegisteredVia,
        createdAt: s.createdAt,
      });
    }
    const res = await prisma.patient.createMany({ data: rows, skipDuplicates: true });
    created += res.count;
    console.log(`[seed] ${end}/${n} (insertados en este lote: ${res.count})`);
  }

  console.log(`[seed] LISTO. Insertados ${created} pacientes sintéticos.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('[seed] Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
