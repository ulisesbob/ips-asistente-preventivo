/**
 * Production seed: 9 IPS programs + 1 admin account.
 * NO test data (no fake doctors, patients, or enrollments).
 * Run with: npx tsx packages/db/src/seed-prod.ts
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

// ─── 9 Programas oficiales del IPS ──────────────────────────────

const programsData = [
  {
    name: 'Diabetes',
    description: 'Programa de seguimiento para pacientes con diabetes. Control de hemoglobina glicosilada cada 3 meses.',
    reminderFrequencyDays: 90,
    templateMessage: 'Hola {{nombre}}, desde el IPS le recordamos que es momento de realizar su control de hemoglobina glicosilada. Tiene cobertura 100% en el laboratorio del IPS. Para más información, responda a este mensaje.',
    centers: [
      { city: 'Posadas', name: 'Laboratorio Central IPS', address: 'Junín 177' },
      { city: 'Oberá', name: 'Delegación Oberá', address: 'Sarmiento 555' },
      { city: 'Eldorado', name: 'Delegación Eldorado', address: 'San Martín 1200' },
    ],
  },
  {
    name: 'Mujer Sana',
    description: 'Programa preventivo para mujeres. Mamografía + PAP anual.',
    reminderFrequencyDays: 365,
    templateMessage: 'Hola {{nombre}}, es momento de realizar su mamografía + PAP. La chequera Mujer Sana le cubre estos estudios de forma gratuita. Retírela en Junín 177 o en su delegación.',
    centers: [
      { city: 'Posadas', name: 'Hospital Madariaga', address: 'Av. Marconi 3736' },
      { city: 'Oberá', name: 'Hospital SAMIC Oberá', address: 'Eugenio Ramírez s/n' },
      { city: 'Posadas', name: 'Sede Central IPS', address: 'Junín 177' },
    ],
  },
  {
    name: 'Hombre Sano',
    description: 'Programa preventivo para hombres. Control de PSA + ecografía anual.',
    reminderFrequencyDays: 365,
    templateMessage: 'Hola {{nombre}}, es momento de realizar su control de PSA + ecografía. La chequera Hombre Sano le cubre estos estudios. Retírela en su delegación más cercana.',
    centers: [
      { city: 'Posadas', name: 'Sede Central IPS', address: 'Junín 177' },
      { city: 'Oberá', name: 'Delegación Oberá', address: 'Sarmiento 555' },
    ],
  },
  {
    name: 'PREDHICAR',
    description: 'Programa de prevención y control de hipertensión arterial. Control mensual de presión.',
    reminderFrequencyDays: 30,
    templateMessage: 'Hola {{nombre}}, recuerde controlar su presión arterial. Si no tiene tensiómetro, puede acercarse a su delegación o farmacia propia del IPS.',
    centers: [
      { city: 'Posadas', name: 'Farmacia IPS Central', address: 'Junín 177' },
      { city: 'Oberá', name: 'Farmacia IPS Oberá', address: 'Sarmiento 555' },
      { city: 'Eldorado', name: 'Farmacia IPS Eldorado', address: 'San Martín 1200' },
    ],
  },
  {
    name: 'Osteoporosis',
    description: 'Programa de seguimiento de osteoporosis. Densitometría ósea anual.',
    reminderFrequencyDays: 365,
    templateMessage: 'Hola {{nombre}}, es momento de realizar su densitometría ósea anual. Centros habilitados: Eldorado, Puerto Rico, Oberá, Posadas.',
    centers: [
      { city: 'Posadas', name: 'Centro de Diagnóstico Posadas', address: 'Bolívar 1550' },
      { city: 'Oberá', name: 'Centro de Diagnóstico Oberá', address: 'Bolívar 980' },
      { city: 'Eldorado', name: 'Centro de Diagnóstico Eldorado', address: 'San Martín 800' },
      { city: 'Puerto Rico', name: 'Centro de Diagnóstico Puerto Rico', address: 'Jujuy 450' },
    ],
  },
  {
    name: 'Oncológico',
    description: 'Programa de seguimiento oncológico. Frecuencia configurable (3/6/12 meses).',
    reminderFrequencyDays: 90,
    templateMessage: 'Hola {{nombre}}, le recordamos su control oncológico programado. Tiene cobertura del 100% en prácticas y medicamentos. Consulte con su médico tratante.',
    centers: [
      { city: 'Posadas', name: 'Hospital Madariaga - Oncología', address: 'Av. Marconi 3736' },
      { city: 'Posadas', name: 'Farmacia IPS Oncológica', address: 'Junín 177' },
    ],
  },
  {
    name: 'Celíacos',
    description: 'Programa de seguimiento para pacientes celíacos. Control anual + cobertura de productos.',
    reminderFrequencyDays: 365,
    templateMessage: 'Hola {{nombre}}, es momento de su control anual de celiaquía. Recuerde que tiene cobertura de harinas y productos especiales.',
    centers: [
      { city: 'Posadas', name: 'Sede Central IPS', address: 'Junín 177' },
      { city: 'Oberá', name: 'Delegación Oberá', address: 'Sarmiento 555' },
    ],
  },
  {
    name: 'Cáncer de Colon',
    description: 'Programa de screening de cáncer de colon. Sangre oculta en materia fecal anual.',
    reminderFrequencyDays: 365,
    templateMessage: 'Hola {{nombre}}, le recordamos realizar su screening de sangre oculta en materia fecal. Solicite la orden en su delegación.',
    centers: [
      { city: 'Posadas', name: 'Laboratorio Central IPS', address: 'Junín 177' },
      { city: 'Oberá', name: 'Delegación Oberá', address: 'Sarmiento 555' },
    ],
  },
  {
    name: 'Plan Materno Infantil',
    description: 'Programa de seguimiento prenatal y neonatal. Control según semana de gestación.',
    reminderFrequencyDays: 30,
    templateMessage: 'Hola {{nombre}}, según su calendario prenatal, le corresponde un control esta semana. Tiene cobertura completa de parto y neonatología.',
    centers: [
      { city: 'Posadas', name: 'Hospital Madariaga - Maternidad', address: 'Av. Marconi 3736' },
      { city: 'Oberá', name: 'Hospital SAMIC Oberá', address: 'Eugenio Ramírez s/n' },
    ],
  },
];

async function main() {
  console.log('[Seed Prod] Seeding production database...\n');

  // 1. Create 9 IPS programs
  console.log('[Seed Prod] Creating 9 IPS programs...');
  for (const prog of programsData) {
    await prisma.program.upsert({
      where: { name: prog.name },
      update: {
        description: prog.description,
        reminderFrequencyDays: prog.reminderFrequencyDays,
        templateMessage: prog.templateMessage,
        centers: prog.centers,
      },
      create: prog,
    });
  }
  console.log('  9 programs created/updated\n');

  // 2. Create admin account
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ips.gob.ar';
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    console.error('[Seed Prod] ERROR: ADMIN_PASSWORD env var is required for production seed.');
    console.error('  Usage: ADMIN_PASSWORD=SecurePass123! npx tsx packages/db/src/seed-prod.ts');
    process.exit(1);
  }

  console.log(`[Seed Prod] Creating admin account (${adminEmail})...`);
  const existingAdmin = await prisma.doctor.findUnique({ where: { email: adminEmail } });

  if (existingAdmin) {
    console.log('  Admin already exists — skipping (password not overwritten)\n');
  } else {
    const hash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    await prisma.doctor.create({
      data: {
        fullName: 'Administrador IPS',
        email: adminEmail,
        passwordHash: hash,
        role: Role.ADMIN,
      },
    });
    console.log('  Admin created\n');
  }

  console.log('[Seed Prod] Production seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('[Seed Prod] Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
