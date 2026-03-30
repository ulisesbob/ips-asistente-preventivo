import { PrismaClient, Role, Gender, RegisteredVia, PatientProgramStatus } from '@prisma/client';
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

// ─── Médicos de prueba ──────────────────────────────────────────

const doctorsData = [
  { fullName: 'Dr. Admin IPS', email: 'admin@ips.gob.ar', password: 'Admin2026!', role: Role.ADMIN, programs: [] as string[] },
  { fullName: 'Dr. Roberto Fernández', email: 'rfernandez@ips.gob.ar', password: 'Doctor2026!', role: Role.DOCTOR, programs: ['Diabetes', 'PREDHICAR'] },
  { fullName: 'Dra. Laura Benítez', email: 'lbenitez@ips.gob.ar', password: 'Doctor2026!', role: Role.DOCTOR, programs: ['Mujer Sana', 'Plan Materno Infantil'] },
  { fullName: 'Dr. Carlos Ayala', email: 'cayala@ips.gob.ar', password: 'Doctor2026!', role: Role.DOCTOR, programs: ['Hombre Sano', 'Oncológico'] },
  { fullName: 'Dra. María Sosa', email: 'msosa@ips.gob.ar', password: 'Doctor2026!', role: Role.DOCTOR, programs: ['Osteoporosis', 'Celíacos'] },
  { fullName: 'Dr. Jorge Méndez', email: 'jmendez@ips.gob.ar', password: 'Doctor2026!', role: Role.DOCTOR, programs: ['Cáncer de Colon', 'Oncológico'] },
];

// ─── Pacientes de prueba (50) ───────────────────────────────────

const patientsData: Array<{ fullName: string; dni: string; phone: string; gender: Gender; programs: string[] }> = [
  { fullName: 'María García López', dni: '28456789', phone: '+5493764123456', gender: Gender.F, programs: ['Mujer Sana', 'Diabetes'] },
  { fullName: 'Juan Carlos Rodríguez', dni: '25789012', phone: '+5493764234567', gender: Gender.M, programs: ['Diabetes', 'PREDHICAR'] },
  { fullName: 'Ana Beatriz Fernández', dni: '30123456', phone: '+5493764345678', gender: Gender.F, programs: ['Mujer Sana'] },
  { fullName: 'Roberto Daniel Martínez', dni: '22345678', phone: '+5493764456789', gender: Gender.M, programs: ['Hombre Sano', 'PREDHICAR'] },
  { fullName: 'Claudia Inés Benítez', dni: '27890123', phone: '+5493764567890', gender: Gender.F, programs: ['Osteoporosis', 'Diabetes'] },
  { fullName: 'Jorge Alberto Sosa', dni: '24567890', phone: '+5493764678901', gender: Gender.M, programs: ['Oncológico'] },
  { fullName: 'Graciela del Carmen Ayala', dni: '29012345', phone: '+5493764789012', gender: Gender.F, programs: ['Celíacos'] },
  { fullName: 'Pedro Luis Gómez', dni: '23456789', phone: '+5493764890123', gender: Gender.M, programs: ['Cáncer de Colon'] },
  { fullName: 'Silvia Noemí López', dni: '31234567', phone: '+5493764901234', gender: Gender.F, programs: ['Plan Materno Infantil'] },
  { fullName: 'Carlos Eduardo Méndez', dni: '26789012', phone: '+5493765012345', gender: Gender.M, programs: ['Diabetes', 'Hombre Sano'] },
  { fullName: 'Rosa María Villalba', dni: '28901234', phone: '+5493765123456', gender: Gender.F, programs: ['Mujer Sana', 'PREDHICAR'] },
  { fullName: 'Miguel Ángel Acuña', dni: '21345678', phone: '+5493765234567', gender: Gender.M, programs: ['PREDHICAR', 'Oncológico'] },
  { fullName: 'Marta Susana Torres', dni: '33456789', phone: '+5493765345678', gender: Gender.F, programs: ['Diabetes'] },
  { fullName: 'Diego Armando Pérez', dni: '25012345', phone: '+5493765456789', gender: Gender.M, programs: ['Hombre Sano'] },
  { fullName: 'Liliana del Valle Duarte', dni: '30567890', phone: '+5493765567890', gender: Gender.F, programs: ['Osteoporosis'] },
  { fullName: 'Ramón Esteban Cardozo', dni: '22678901', phone: '+5493765678901', gender: Gender.M, programs: ['Diabetes', 'PREDHICAR'] },
  { fullName: 'Patricia Alejandra Núñez', dni: '29345678', phone: '+5493765789012', gender: Gender.F, programs: ['Mujer Sana', 'Celíacos'] },
  { fullName: 'Héctor Hugo Romero', dni: '24890123', phone: '+5493765890123', gender: Gender.M, programs: ['Cáncer de Colon'] },
  { fullName: 'Estela Maris Cabrera', dni: '27012345', phone: '+5493765901234', gender: Gender.F, programs: ['Diabetes', 'Osteoporosis'] },
  { fullName: 'Fernando Javier Vera', dni: '23789012', phone: '+5493766012345', gender: Gender.M, programs: ['PREDHICAR'] },
  { fullName: 'Norma Gladys Giménez', dni: '32123456', phone: '+5493766123456', gender: Gender.F, programs: ['Mujer Sana'] },
  { fullName: 'Raúl Oscar Domínguez', dni: '20456789', phone: '+5493766234567', gender: Gender.M, programs: ['Hombre Sano', 'Diabetes'] },
  { fullName: 'Alicia Beatriz Leiva', dni: '28234567', phone: '+5493766345678', gender: Gender.F, programs: ['Oncológico'] },
  { fullName: 'Daniel Alejandro Báez', dni: '25456789', phone: '+5493766456789', gender: Gender.M, programs: ['PREDHICAR', 'Diabetes'] },
  { fullName: 'Mirta Graciela Ortiz', dni: '31678901', phone: '+5493766567890', gender: Gender.F, programs: ['Plan Materno Infantil'] },
  { fullName: 'Sergio Fabián Ríos', dni: '22901234', phone: '+5493766678901', gender: Gender.M, programs: ['Cáncer de Colon', 'PREDHICAR'] },
  { fullName: 'Gladys Noelia Ramírez', dni: '29678901', phone: '+5493766789012', gender: Gender.F, programs: ['Celíacos', 'Diabetes'] },
  { fullName: 'José Luis Brítez', dni: '24123456', phone: '+5493766890123', gender: Gender.M, programs: ['Oncológico', 'PREDHICAR'] },
  { fullName: 'Teresa del Carmen Sánchez', dni: '27456789', phone: '+5493766901234', gender: Gender.F, programs: ['Osteoporosis', 'Mujer Sana'] },
  { fullName: 'Víctor Manuel Alvarez', dni: '23012345', phone: '+5493767012345', gender: Gender.M, programs: ['Diabetes'] },
  { fullName: 'Irma Beatriz González', dni: '30789012', phone: '+5493767123456', gender: Gender.F, programs: ['Mujer Sana', 'PREDHICAR'] },
  { fullName: 'Enrique Adrián Castro', dni: '21678901', phone: '+5493767234567', gender: Gender.M, programs: ['Hombre Sano'] },
  { fullName: 'Carmen Rosa Medina', dni: '28567890', phone: '+5493767345678', gender: Gender.F, programs: ['Diabetes', 'Celíacos'] },
  { fullName: 'Rubén Darío Flores', dni: '25890123', phone: '+5493767456789', gender: Gender.M, programs: ['PREDHICAR'] },
  { fullName: 'Susana del Valle Amarilla', dni: '32890123', phone: '+5493767567890', gender: Gender.F, programs: ['Oncológico', 'Mujer Sana'] },
  { fullName: 'Osvaldo Ramón Krawczyk', dni: '20890123', phone: '+5493767678901', gender: Gender.M, programs: ['Diabetes', 'Cáncer de Colon'] },
  { fullName: 'Blanca Nieves Paredes', dni: '29901234', phone: '+5493767789012', gender: Gender.F, programs: ['Osteoporosis'] },
  { fullName: 'Marcelo Fabián Insaurralde', dni: '24345678', phone: '+5493767890123', gender: Gender.M, programs: ['PREDHICAR', 'Diabetes'] },
  { fullName: 'Olga Nélida Riquelme', dni: '27678901', phone: '+5493767901234', gender: Gender.F, programs: ['Plan Materno Infantil'] },
  { fullName: 'Néstor Fabián Escobar', dni: '23345678', phone: '+5493768012345', gender: Gender.M, programs: ['Hombre Sano', 'PREDHICAR'] },
  { fullName: 'Adriana del Pilar Aguirre', dni: '31012345', phone: '+5493768123456', gender: Gender.F, programs: ['Mujer Sana'] },
  { fullName: 'Walter Hugo Chávez', dni: '22012345', phone: '+5493768234567', gender: Gender.M, programs: ['Oncológico'] },
  { fullName: 'Mónica Patricia Ledesma', dni: '28678901', phone: '+5493768345678', gender: Gender.F, programs: ['Diabetes', 'PREDHICAR'] },
  { fullName: 'Julio César Aquino', dni: '25123456', phone: '+5493768456789', gender: Gender.M, programs: ['Cáncer de Colon'] },
  { fullName: 'Elena del Socorro Benítez', dni: '30234567', phone: '+5493768567890', gender: Gender.F, programs: ['Celíacos'] },
  { fullName: 'Alberto Daniel Ojeda', dni: '21890123', phone: '+5493768678901', gender: Gender.M, programs: ['Diabetes'] },
  { fullName: 'Zulma Graciela Franco', dni: '29234567', phone: '+5493768789012', gender: Gender.F, programs: ['Osteoporosis', 'Mujer Sana'] },
  { fullName: 'Ricardo Ariel Da Silva', dni: '24678901', phone: '+5493768890123', gender: Gender.M, programs: ['PREDHICAR'] },
  { fullName: 'Nilda Beatriz Cabral', dni: '27234567', phone: '+5493768901234', gender: Gender.F, programs: ['Plan Materno Infantil'] },
  { fullName: 'Gustavo Adolfo Dos Santos', dni: '23678901', phone: '+5493769012345', gender: Gender.M, programs: ['Hombre Sano', 'Diabetes'] },
];

async function main() {
  console.log('Seeding database...\n');

  // 1. Crear programas
  console.log('Creating 9 IPS programs...');
  const programMap = new Map<string, string>();
  for (const prog of programsData) {
    const created = await prisma.program.upsert({
      where: { name: prog.name },
      update: {
        description: prog.description,
        reminderFrequencyDays: prog.reminderFrequencyDays,
        templateMessage: prog.templateMessage,
        centers: prog.centers,
      },
      create: prog,
    });
    programMap.set(prog.name, created.id);
  }
  console.log(`  ✓ ${programMap.size} programs created\n`);

  // 2. Crear médicos + asignar a programas
  console.log('Creating doctors...');
  const doctorMap = new Map<string, string>();
  for (const doc of doctorsData) {
    const hash = await bcrypt.hash(doc.password, SALT_ROUNDS);
    const created = await prisma.doctor.upsert({
      where: { email: doc.email },
      update: {
        fullName: doc.fullName,
        passwordHash: hash,
        role: doc.role,
      },
      create: {
        fullName: doc.fullName,
        email: doc.email,
        passwordHash: hash,
        role: doc.role,
      },
    });
    doctorMap.set(doc.email, created.id);

    // Asignar programas
    for (const progName of doc.programs) {
      const progId = programMap.get(progName);
      if (!progId) continue;
      await prisma.doctorProgram.upsert({
        where: {
          doctorId_programId: { doctorId: created.id, programId: progId },
        },
        update: {},
        create: {
          doctorId: created.id,
          programId: progId,
        },
      });
    }
  }
  console.log(`  ✓ ${doctorMap.size} doctors created\n`);

  // 3. Crear pacientes + inscribir en programas
  console.log('Creating 50 patients...');
  const adminId = doctorMap.get('admin@ips.gob.ar');
  if (!adminId) throw new Error('Admin doctor not found after seeding');
  let patientCount = 0;
  let enrollmentCount = 0;

  for (const pat of patientsData) {
    const patient = await prisma.patient.upsert({
      where: { dni: pat.dni },
      update: {
        fullName: pat.fullName,
        phone: pat.phone,
        gender: pat.gender,
      },
      create: {
        fullName: pat.fullName,
        dni: pat.dni,
        phone: pat.phone,
        gender: pat.gender,
        consent: true,
        registeredVia: RegisteredVia.IMPORT,
        whatsappLinked: true,
      },
    });
    patientCount++;

    // Inscribir en programas
    for (const progName of pat.programs) {
      const progId = programMap.get(progName);
      if (!progId) continue;

      const program = programsData.find((p) => p.name === progName)!;
      const nextReminder = new Date();
      nextReminder.setDate(nextReminder.getDate() + program.reminderFrequencyDays);

      await prisma.patientProgram.upsert({
        where: {
          patientId_programId: { patientId: patient.id, programId: progId },
        },
        update: {},
        create: {
          patientId: patient.id,
          programId: progId,
          enrolledByDoctorId: adminId,
          nextReminderDate: nextReminder,
          status: PatientProgramStatus.ACTIVE,
        },
      });
      enrollmentCount++;
    }
  }
  console.log(`  ✓ ${patientCount} patients created`);
  console.log(`  ✓ ${enrollmentCount} program enrollments created\n`);

  console.log('Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
