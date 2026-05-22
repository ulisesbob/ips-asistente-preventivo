/**
 * Detecta (y opcionalmente normaliza) teléfonos no canónicos en pacientes existentes.
 *
 * El fix de anti-duplicados normaliza al ESCRIBIR, pero la data vieja pudo quedar en
 * formatos distintos del mismo número (ej. +543764... sin el 9 cargado a mano vs
 * +5493764... del bot). Este script:
 *   - reporta cuántos teléfonos cambiarían a su forma canónica;
 *   - DETECTA COLISIONES: dos pacientes cuyo teléfono canónico coincide = duplicado
 *     real que hay que resolver a mano (no se toca);
 *   - con --fix normaliza SOLO los que no colisionan (nunca viola el @unique).
 *
 * Uso (read-only):
 *   DATABASE_URL='...' PRISMA_FIELD_ENCRYPTION_KEY='...' npx tsx scripts/check-phone-dupes.ts
 * Aplicar la normalización segura:
 *   DATABASE_URL='...' PRISMA_FIELD_ENCRYPTION_KEY='...' npx tsx scripts/check-phone-dupes.ts --fix
 */
import { prisma } from '@ips/db';
import { canonicalPhone } from '../src/utils/phone';

async function main(): Promise<void> {
  const apply = process.argv.includes('--fix');

  const patients = await prisma.patient.findMany({
    where: { phone: { not: null } },
    select: { id: true, dni: true, phone: true },
  });

  // canónico → pacientes que terminarían con ese teléfono
  const byCanonical = new Map<string, { id: string; dni: string; phone: string }[]>();
  for (const p of patients) {
    const canon = canonicalPhone(p.phone as string);
    const arr = byCanonical.get(canon) ?? [];
    arr.push({ id: p.id, dni: p.dni, phone: p.phone as string });
    byCanonical.set(canon, arr);
  }

  const collisions = [...byCanonical.entries()].filter(([, arr]) => arr.length > 1);
  const needFix = patients.filter((p) => p.phone !== canonicalPhone(p.phone as string));

  console.log(`Pacientes con teléfono: ${patients.length}`);
  console.log(`Teléfonos no canónicos (cambiarían): ${needFix.length}`);
  console.log(`Colisiones (duplicados reales a resolver a mano): ${collisions.length}`);

  for (const [canon, arr] of collisions) {
    console.log(`  ⚠️  ${canon} ← ${arr.map((a) => `DNI ${a.dni} (${a.phone})`).join('  |  ')}`);
  }

  if (!apply) {
    console.log('\n(read-only) Pasá --fix para normalizar los que NO colisionan.');
    return;
  }

  let fixed = 0;
  for (const [canon, arr] of byCanonical.entries()) {
    if (arr.length > 1) continue; // colisión → no tocar
    const only = arr[0];
    if (only.phone === canon) continue; // ya canónico
    await prisma.patient.update({ where: { id: only.id }, data: { phone: canon } });
    fixed++;
  }
  console.log(`\nNormalizados: ${fixed}. Colisiones sin tocar: ${collisions.length} (resolvé esos a mano).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
