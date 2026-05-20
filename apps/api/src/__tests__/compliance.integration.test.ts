import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, runWithAuditActor, Role, RegisteredVia, MessageRole } from '@ips/db';
import * as patientService from '../services/patient.service';

// Tests de INTEGRACIÓN: corren contra un Postgres real (no mocks).
// Requiere DATABASE_URL apuntando a una DB de test ya migrada. Ej:
//   DATABASE_URL=postgresql://test:test@localhost:5499/ips_test \
//     npx vitest run src/__tests__/compliance.integration.test.ts
// Se saltea solo si no hay DATABASE_URL de test (para no romper la suite unitaria).

// Corre solo contra un Postgres de test REAL (localhost), nunca contra el dummy
// que setup.ts inyecta para los tests unitarios (postgresql://...@localhost:5432/test).
// Sin esta exclusión, `npx vitest run` sin DATABASE_URL intentaría conectar al 5432
// inexistente y rompería la suite en CI.
const DUMMY_DB = 'postgresql://test:test@localhost:5432/test';
const HAS_TEST_DB =
  !!process.env.DATABASE_URL &&
  process.env.DATABASE_URL.includes('localhost') &&
  process.env.DATABASE_URL !== DUMMY_DB;
const d = HAS_TEST_DB ? describe : describe.skip;

// Espera al audit log fire-and-forget.
const settle = () => new Promise((r) => setTimeout(r, 250));

d('Compliance (integración, DB real)', () => {
  let doctorId: string;
  const DNI = '30111222';

  beforeAll(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.patient.deleteMany();
    await prisma.doctor.deleteMany();
    const doc = await prisma.doctor.create({
      data: { fullName: 'Dr Test', email: `t${Date.now()}@test.local`, passwordHash: 'x', role: Role.ADMIN },
    });
    doctorId = doc.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('audit log registra actor, acción y campos en el create de Patient', async () => {
    await runWithAuditActor({ actorType: 'DOCTOR', actorId: doctorId }, async () => {
      await patientService.upsertPatientByDni({ fullName: 'Ana Test', dni: DNI, consent: true }, RegisteredVia.PANEL);
    });
    await settle();

    const logs = await prisma.auditLog.findMany({ where: { model: 'Patient', action: 'CREATE', actorId: doctorId } });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].actorType).toBe('DOCTOR');
    expect(logs[0].changedFields).toContain('dni');
    expect(logs[0].changedFields).toContain('consentAt');
  });

  it('NO se auditan a sí mismos los AuditLog (anti-recursión)', async () => {
    const auditOfAudit = await prisma.auditLog.findMany({ where: { model: 'AuditLog' } });
    expect(auditOfAudit.length).toBe(0);
  });

  it('consentAt y consentVia se persisten', async () => {
    const p = await prisma.patient.findFirst({ where: { dni: DNI } });
    expect(p!.consentAt).toBeTruthy();
    expect(p!.consentVia).toBe('PANEL');
  });

  it('soft-delete marca deletedAt y lo saca del listado', async () => {
    const p = await prisma.patient.findFirst({ where: { dni: DNI } });
    await patientService.softDeletePatient(p!.id);

    const deleted = await prisma.patient.findFirst({ where: { id: p!.id } });
    expect(deleted!.deletedAt).toBeTruthy();

    const list = await patientService.listPatients(doctorId, Role.ADMIN, { page: 1, limit: 50 });
    expect(list.patients.find((x) => x.id === p!.id)).toBeUndefined();
  });

  it('reactivación por DNI: re-registrar un DNI borrado lo reactiva', async () => {
    await runWithAuditActor({ actorType: 'DOCTOR', actorId: doctorId }, async () => {
      await patientService.upsertPatientByDni({ fullName: 'Ana Test', dni: DNI, consent: true }, RegisteredVia.PANEL);
    });
    const reactivated = await prisma.patient.findFirst({ where: { dni: DNI } });
    expect(reactivated!.deletedAt).toBeNull();
  });

  it('cifrado en reposo: Message.content se persiste cifrado y se lee en claro', async () => {
    const secret = 'sintoma confidencial mareos 12345';
    const conv = await prisma.conversation.create({ data: { phone: `+5490${Date.now()}` } });
    const msg = await prisma.message.create({
      data: { conversationId: conv.id, role: MessageRole.USER, content: secret },
    });

    // El cliente extendido descifra de forma transparente al leer.
    const readBack = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(readBack!.content).toBe(secret);

    // Lectura cruda (raw SQL no pasa por la extensión): debe estar CIFRADO en la DB.
    const raw = await prisma.$queryRawUnsafe<Array<{ content: string }>>(
      'SELECT content FROM messages WHERE id = $1::uuid',
      msg.id
    );
    expect(raw[0].content).not.toBe(secret);
    expect(raw[0].content).not.toContain('confidencial');
    expect(raw[0].content).toMatch(/aesgcm/i);
  });

  it('import CSV masivo SÍ se audita (cada create dentro de $transaction interactiva)', async () => {
    const importDni = '40555666';
    const csv = `fullName,dni,phone,birthDate,gender\nCarlos Import,${importDni},,,M`;
    await runWithAuditActor({ actorType: 'DOCTOR', actorId: doctorId }, async () => {
      await patientService.importPatientsFromCsv(csv);
    });
    await settle();

    const created = await prisma.patient.findFirst({ where: { dni: importDni } });
    expect(created).toBeTruthy();

    const logs = await prisma.auditLog.findMany({
      where: { model: 'Patient', action: 'CREATE', recordId: created!.id },
    });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].actorType).toBe('DOCTOR');
  });
});
