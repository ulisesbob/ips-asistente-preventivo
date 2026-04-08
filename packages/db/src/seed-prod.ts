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

  // 3. Seed knowledge base — 30 FAQs reales del IPS
  console.log('[Seed Prod] Seeding knowledge base (30 FAQs)...');

  const kbData = [
    // === COBERTURAS Y PRESTACIONES ===
    { category: 'Coberturas', question: '¿Qué cubre el IPS?', answer: 'El IPS brinda cobertura a 180.503 afiliados bajo el PMO. Cubre: consultas médicas (Nivel I), especialistas y ecografías (Nivel II), resonancia magnética, tomografía y cirugías cardiovasculares (Nivel III). También cubre internación 100% (medicamentos y descartables incluidos), diálisis 100%, trasplantes 100% (pre y post), prótesis y órtesis 100%, implantes cocleares, y servicios fúnebres 100%. Libre elección de prestadores sin derivación previa.', sortOrder: 1 },
    { category: 'Coberturas', question: '¿El IPS cubre lentes/anteojos?', answer: 'Sí, el IPS cubre lentes de contacto, lentes bifocales y armazones sobre valores establecidos. Necesitás receta del oftalmólogo del IPS. El trámite se hace en la Obra Social (Junín 1563, Posadas).', sortOrder: 2 },
    { category: 'Coberturas', question: '¿El IPS cubre prótesis y órtesis?', answer: 'Sí, cobertura del 100% en prótesis y órtesis, tanto nacionales como importadas. Necesitás orden del especialista del IPS y autorización de Auditoría Médica.', sortOrder: 3 },
    { category: 'Coberturas', question: '¿Cómo retiro medicamentos?', answer: 'Los medicamentos se retiran en la Farmacia del IPS (Junín 177, Posadas, tel. 0376-444-8684) o en las bocas de expendio de tu delegación, con receta del médico del IPS. Los programas crónicos (Diabetes, Hipertensión) tienen medicación 100% gratuita. Genéricos con hasta 40% de descuento.', sortOrder: 4 },
    { category: 'Coberturas', question: '¿El IPS cubre cirugías?', answer: 'Sí, el IPS cubre cirugías programadas y de urgencia en sanatorios y clínicas prestadoras, y en hospitales públicos de la provincia mediante órdenes médicas. Para cirugías programadas necesitás autorización previa de Auditoría Médica.', sortOrder: 5 },
    { category: 'Coberturas', question: '¿El IPS cubre trasplantes?', answer: 'Sí, cobertura 100% en tratamiento pre y post trasplante de médula, riñón, hígado y córnea.', sortOrder: 6 },
    { category: 'Coberturas', question: '¿El IPS cubre salud mental?', answer: 'Sí, el IPS cubre kinesioterapia, psicología, nutrición, y atención especializada en salud mental y discapacidad.', sortOrder: 7 },
    { category: 'Coberturas', question: '¿El IPS cubre diálisis?', answer: 'Sí, cobertura 100% en centros de diálisis de Posadas, Oberá y Eldorado.', sortOrder: 8 },

    // === TRÁMITES Y TURNOS ===
    { category: 'Trámites', question: '¿Cómo saco turno con un especialista?', answer: 'El IPS tiene libre elección de prestadores sin necesidad de derivación previa. Podés acceder directo al especialista con bono de consulta. Policonsultorio IPS: Junín 1779, Posadas, tel. 0376-444-8750. También podés llamar al 0800-888-0109.', sortOrder: 1 },
    { category: 'Trámites', question: '¿Qué necesito para hacerme estudios de laboratorio?', answer: 'Necesitás: (1) Orden médica del IPS, (2) DNI, (3) Carnet de afiliado. Para análisis de sangre: ir en ayunas. Laboratorio Central IPS: Ayacucho 270, Posadas, tel. 0376-444-8692 / 0376-444-8620.', sortOrder: 2 },
    { category: 'Trámites', question: '¿Cómo me afilio al IPS?', answer: 'Las afiliaciones se tramitan en San Martín 2133, Posadas, tel. 0376-444-8639. Necesitás DNI, recibo de sueldo y documentación del grupo familiar (partidas de nacimiento/matrimonio).', sortOrder: 3 },
    { category: 'Trámites', question: '¿Cómo pido un reintegro?', answer: 'Los reintegros se tramitan con autorización previa de Auditoría Médica. Presentate en la Obra Social (Junín 1563, Posadas) con la factura, orden médica y DNI.', sortOrder: 4 },
    { category: 'Trámites', question: '¿Dónde retiro las chequeras de los programas?', answer: 'Las chequeras de todos los programas especiales (Diabetes, Mujer Sana, etc.) se retiran en el Área de Programas Especiales, planta baja del edificio central (Junín 177, Posadas) o en las delegaciones provinciales.', sortOrder: 5 },

    // === PROGRAMAS ===
    { category: 'Programas', question: '¿Qué es el programa de Diabetes?', answer: 'Programa para afiliados con diagnóstico de diabetes. Hay 3 tipos de chequera: Tipo I (insulinodependientes), Tipo II (hipoglucemiantes orales), Tipo III (insulino-requerientes). Incluye: 6 consultas médico cabecera, 6 consultas diabetólogo, 2 controles de pie, 2 cardiología, 2 oftalmología, 1 nutricionista, 6 análisis bioquímicos, 12 retiros de medicamentos. Cobertura 100% en insulina, hipoglucemiantes y tiras reactivas.', sortOrder: 1 },
    { category: 'Programas', question: '¿Qué es el programa Mujer Sana?', answer: 'Programa de prevención y detección de cáncer de mama y útero. Para afiliadas desde 40 años (o menores con antecedentes familiares). Cobertura 100% gratuita: consulta ginecológica, colposcopía, mamografía + ecografía, Papanicolaou, y detección de HPV.', sortOrder: 2 },
    { category: 'Programas', question: '¿Qué es el programa Hombre Sano?', answer: 'Programa de prevención de enfermedades de próstata y sistema urinario. Para afiliados desde 45 años. La chequera incluye: 1 consulta médico cabecera, 1 análisis bioquímico, 1 ecografía renal y prostática, 2 consultas urológicas.', sortOrder: 3 },
    { category: 'Programas', question: '¿Qué es PREDHICAR?', answer: 'Programa de prevención y control de hipertensión arterial. Para afiliados desde 40 años. La chequera incluye: 4 consultas cardiología, 2 análisis bioquímicos, 1 hoja indicaciones médicas, 12 órdenes de retiro de medicamentos.', sortOrder: 4 },
    { category: 'Programas', question: '¿Qué es el programa Oncológico?', answer: 'Atención integral al paciente oncológico con enfoque multidisciplinario. La chequera incluye: 9 órdenes de apoyo psicológico individual, 1 apoyo familiar, 1 solicitud tratamiento del dolor, 1 drenaje linfático.', sortOrder: 5 },
    { category: 'Programas', question: '¿Qué es el Plan Materno Infantil?', answer: 'Cobertura integral del embarazo, parto y post-parto. PRE-NATAL: 7 consultas gineco-obstetra, 3 análisis trimestrales, 3 ecografías, 3 nutricionista, 1 cardiología + ECG, 1 monitoreo fetal. POST-PARTO: 4 consultas, 100% internación hasta 60 días. CONTROL NIÑO (hasta 2 años): 18 consultas pediatra.', sortOrder: 6 },
    { category: 'Programas', question: '¿Qué es el programa de Celíacos?', answer: 'Programa para afiliados con diagnóstico confirmado de celiaquía. Incluye: consultas médicas, 2 consultas gastroenterólogo, 1 nutricionista, plan alimentario, 12 cajas alimentarias gratuitas, 2 recetarios medicamentos.', sortOrder: 7 },
    { category: 'Programas', question: '¿Qué es el programa de Osteoporosis?', answer: 'Prevención y detección temprana mediante densitometría ósea. Para afiliados a partir de 50 años. Densitometría ósea gratuita en Eldorado, Puerto Rico, Oberá y Posadas.', sortOrder: 8 },
    { category: 'Programas', question: '¿Qué es el programa de Cáncer de Colon?', answer: 'Prevención y detección temprana del cáncer colorrectal. Para hombres y mujeres a partir de 45 años. Incluye análisis monoclonal de sangre oculta en materia fecal, gratuito anualmente.', sortOrder: 9 },
    { category: 'Programas', question: '¿Cómo pido el Kit del Recién Nacido?', answer: 'Se gestiona en IPS Programas Especiales (2do piso, Bolívar 2152, tel. 0376-444-8707) o en delegaciones. Documentación: carnet afiliado, recibo haberes, DNI titular y recién nacido, partida nacimiento, y "papel rosado".', sortOrder: 10 },

    // === CONTACTO ===
    { category: 'Contacto', question: '¿Dónde queda la sede central del IPS?', answer: 'Sede Central: Bolívar 2152, Posadas, tel. 0376-444-8653. Obra Social: Junín 1563, tel. 0376-444-8631. Policonsultorio: Junín 1779, tel. 0376-444-8750. Farmacia: Junín 177, tel. 0376-444-8684.', sortOrder: 1 },
    { category: 'Contacto', question: '¿Cuáles son los horarios de atención?', answer: 'Sede Central: lunes a viernes 9:00 a 17:00. Delegaciones de Posadas: 7:00 a 19:00. Bocas de expendio: 7:00 a 13:00. Línea 0800-888-0109 para consultas.', sortOrder: 2 },
    { category: 'Contacto', question: '¿Dónde hay delegaciones del IPS en Posadas?', answer: 'Delegación Itaembé Guazú: Las Orquídeas 10633, tel. 0376-155087373. Delegación Villa Cabello: Chacra 149, tel. 0376-4448020. Delegación Parque de la Salud (Hospital Madariaga): Av. López Torres 3568, tel. 0376-4434172.', sortOrder: 3 },
    { category: 'Contacto', question: '¿Dónde hay delegaciones del IPS en el interior?', answer: 'Oberá: San Martín 773, cel. 3755-751323. Eldorado: Pionero Ziegler 232, WhatsApp 3751635433. Puerto Iguazú: Córdoba y Bompland, tel. 03757-420154. Consultá tu delegación más cercana al 0376-444-6611.', sortOrder: 4 },
    { category: 'Contacto', question: '¿Cómo contacto al IPS?', answer: 'Línea gratuita: 0800-888-0109. Sede Central: Bolívar 2152, Posadas, tel. 0376-444-8653. Email: departamentosanatorialips@gmail.com. Programas Especiales: 0376-444-8707. Afiliaciones: San Martín 2133, tel. 0376-444-8639.', sortOrder: 5 },

    // === URGENCIAS ===
    { category: 'Urgencias', question: '¿Qué hago en una emergencia?', answer: 'Llamá al 107 (SAME) o andá a la guardia más cercana de la red IPS. Presentá DNI y carnet de afiliado. El IPS cubre internación 100%. Si te atienden fuera de la red, podés pedir reintegro en Auditoría Médica.', sortOrder: 1 },
    { category: 'Urgencias', question: '¿El IPS cubre ambulancia?', answer: 'Sí, el IPS cubre traslado en ambulancia dentro de la provincia para emergencias y derivaciones. Coordiná desde la guardia del hospital o llamando al 0800-888-0109.', sortOrder: 2 },
    { category: 'Urgencias', question: '¿El IPS tiene oxigenoterapia domiciliaria?', answer: 'Sí, el IPS brinda oxigenoterapia domiciliaria. Necesitás prescripción del especialista y autorización de Auditoría Médica.', sortOrder: 3 },
  ];

  // Upsert by category+question to avoid wiping admin-created entries
  let kbCreated = 0;
  for (const kb of kbData) {
    const existing = await prisma.knowledgeBase.findFirst({
      where: { category: kb.category, question: kb.question },
    });
    if (existing) {
      await prisma.knowledgeBase.update({
        where: { id: existing.id },
        data: { answer: kb.answer, sortOrder: kb.sortOrder },
      });
    } else {
      await prisma.knowledgeBase.create({ data: kb });
      kbCreated++;
    }
  }
  console.log(`  ${kbCreated} new + ${kbData.length - kbCreated} updated KB entries\n`);

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
