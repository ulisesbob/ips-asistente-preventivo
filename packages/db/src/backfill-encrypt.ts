/**
 * Backfill de cifrado en reposo — cifra las filas YA EXISTENTES de los campos
 * marcados con `/// @encrypted` (PatientNote.content, Message.content).
 *
 * Por qué hace falta: al activar prisma-field-encryption, las filas nuevas se
 * cifran solas, pero las viejas quedan en texto plano (la extensión hace
 * passthrough al leerlas). Este script las re-escribe para forzar el cifrado.
 *
 * Idempotente: re-correrlo sobre filas ya cifradas las descifra al leer y las
 * vuelve a cifrar al escribir (no rompe nada). Seguro de correr más de una vez.
 *
 * Uso (después de aplicar la migración y con PRISMA_FIELD_ENCRYPTION_KEY seteada):
 *   npx tsx packages/db/src/backfill-encrypt.ts            # ejecuta
 *   DRY_RUN=1 npx tsx packages/db/src/backfill-encrypt.ts  # solo cuenta, no escribe
 *
 * Usa un cliente con SOLO la extensión de cifrado (sin audit) para no inundar el
 * audit log con miles de UPDATE de la migración.
 */
import { PrismaClient } from '@prisma/client';
import { fieldEncryptionExtension } from 'prisma-field-encryption';

const BATCH = 500;
const DRY_RUN = process.env.DRY_RUN === '1';

const prisma = new PrismaClient().$extends(fieldEncryptionExtension());

async function backfillModel(
  label: string,
  fetchPage: (cursorId: string | null) => Promise<Array<{ id: string; content: string }>>,
  writeOne: (id: string, content: string) => Promise<unknown>
): Promise<number> {
  let cursorId: string | null = null;
  let processed = 0;

  for (;;) {
    const page = await fetchPage(cursorId);
    if (page.length === 0) break;

    for (const row of page) {
      if (!DRY_RUN) {
        // Re-escribir el mismo valor fuerza el cifrado (la extensión cifra en write).
        await writeOne(row.id, row.content);
      }
      processed++;
    }

    cursorId = page[page.length - 1].id;
    process.stdout.write(`  ${label}: ${processed} procesados\r`);
    if (page.length < BATCH) break;
  }

  console.log(`  ${label}: ${processed} ${DRY_RUN ? 'a cifrar (dry-run)' : 'cifrados'}        `);
  return processed;
}

async function main() {
  console.log(`Backfill de cifrado ${DRY_RUN ? '(DRY RUN — no escribe)' : ''}`);

  await backfillModel(
    'PatientNote.content',
    (cursorId) =>
      prisma.patientNote.findMany({
        take: BATCH,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, content: true },
      }),
    (id, content) => prisma.patientNote.update({ where: { id }, data: { content } })
  );

  await backfillModel(
    'Message.content',
    (cursorId) =>
      prisma.message.findMany({
        take: BATCH,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
        orderBy: { id: 'asc' },
        select: { id: true, content: true },
      }),
    (id, content) => prisma.message.update({ where: { id }, data: { content } })
  );

  console.log('Backfill completo.');
}

main()
  .catch((e) => {
    console.error('Backfill falló:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
