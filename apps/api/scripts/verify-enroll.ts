/**
 * Verifica una autoinscripción de prueba hecha por WhatsApp (fase 2).
 *
 * Busca el paciente por DNI e imprime sus inscripciones (enrolledVia, reviewedAt,
 * status, médico, programa). Solo lectura.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/verify-enroll.ts <DNI>
 *   npx tsx --env-file=.env scripts/verify-enroll.ts          # solo prueba conexión
 */
import { prisma } from '@ips/db';

async function main(): Promise<void> {
  const dni = process.argv[2]?.trim();

  if (!dni) {
    const programs = await prisma.program.count();
    console.log(`[conexión OK] programas en DB: ${programs}. Pasá un DNI para verificar la inscripción.`);
    return;
  }

  const patient = await prisma.patient.findUnique({
    where: { dni },
    select: {
      id: true,
      fullName: true,
      dni: true,
      registeredVia: true,
      whatsappLinked: true,
      consent: true,
      createdAt: true,
      programs: {
        orderBy: { enrolledAt: 'desc' },
        select: {
          enrolledVia: true,
          reviewedAt: true,
          status: true,
          enrolledByDoctorId: true,
          enrolledAt: true,
          nextReminderDate: true,
          program: { select: { name: true } },
        },
      },
    },
  });

  if (!patient) {
    console.log(`No hay paciente con DNI ${dni}.`);
    return;
  }

  console.log('Paciente:', {
    fullName: patient.fullName,
    dni: patient.dni,
    registeredVia: patient.registeredVia,
    whatsappLinked: patient.whatsappLinked,
    consent: patient.consent,
    createdAt: patient.createdAt,
  });
  console.log(`Inscripciones (${patient.programs.length}):`);
  for (const pp of patient.programs) {
    console.log('  -', {
      programa: pp.program.name,
      enrolledVia: pp.enrolledVia,
      reviewedAt: pp.reviewedAt,
      status: pp.status,
      enrolledByDoctorId: pp.enrolledByDoctorId,
      nextReminderDate: pp.nextReminderDate,
      enrolledAt: pp.enrolledAt,
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
