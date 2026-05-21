import { describe, it, expect } from 'vitest';
import {
  shouldAudit,
  auditActionFor,
  extractRecordId,
  extractChangedFields,
  AUDITED_MODELS,
} from '@ips/db';

// Tests REALES: importan la lógica de producción del audit log desde @ips/db,
// no la reimplementan. Si alguien rompe la extensión, estos tests fallan.

describe('auditActionFor', () => {
  it('mapea operaciones de escritura a su acción', () => {
    expect(auditActionFor('create')).toBe('CREATE');
    expect(auditActionFor('createMany')).toBe('CREATE');
    expect(auditActionFor('update')).toBe('UPDATE');
    expect(auditActionFor('updateMany')).toBe('UPDATE');
    expect(auditActionFor('upsert')).toBe('UPDATE');
    expect(auditActionFor('delete')).toBe('DELETE');
    expect(auditActionFor('deleteMany')).toBe('DELETE');
  });

  it('devuelve null para operaciones de lectura', () => {
    expect(auditActionFor('findMany')).toBeNull();
    expect(auditActionFor('findUnique')).toBeNull();
    expect(auditActionFor('count')).toBeNull();
    expect(auditActionFor('aggregate')).toBeNull();
  });
});

describe('shouldAudit', () => {
  it('audita escrituras en modelos sensibles', () => {
    expect(shouldAudit('Patient', 'create')).toBe(true);
    expect(shouldAudit('Patient', 'update')).toBe(true);
    expect(shouldAudit('Patient', 'delete')).toBe(true);
    expect(shouldAudit('PatientNote', 'create')).toBe(true);
  });

  it('NO audita el propio AuditLog (anti-recursión)', () => {
    expect(shouldAudit('AuditLog', 'create')).toBe(false);
  });

  it('NO audita lecturas', () => {
    expect(shouldAudit('Patient', 'findMany')).toBe(false);
    expect(shouldAudit('Patient', 'findUnique')).toBe(false);
  });

  it('NO audita modelos fuera de la lista (ej. Message)', () => {
    expect(shouldAudit('Message', 'create')).toBe(false);
  });

  it('NO audita cuando el modelo es undefined (raw queries)', () => {
    expect(shouldAudit(undefined, 'create')).toBe(false);
  });

  it('Patient está en la lista de modelos auditados', () => {
    expect(AUDITED_MODELS.has('Patient')).toBe(true);
  });
});

describe('extractRecordId', () => {
  it('usa el id del resultado cuando existe', () => {
    expect(extractRecordId({ where: { id: 'w-1' } }, { id: 'r-1' })).toBe('r-1');
  });

  it('cae al where.id cuando el resultado no tiene id (delete)', () => {
    expect(extractRecordId({ where: { id: 'w-1' } }, null)).toBe('w-1');
  });

  it('devuelve null cuando no hay id en ningún lado', () => {
    expect(extractRecordId({ where: { dni: '12345678' } }, null)).toBeNull();
    expect(extractRecordId({}, undefined)).toBeNull();
  });
});

describe('extractChangedFields', () => {
  it('create: nombres de campos del data (sin valores)', () => {
    const fields = extractChangedFields('create', {
      data: { fullName: 'Ana', dni: '12345678', consent: true },
    });
    expect(fields.sort()).toEqual(['consent', 'dni', 'fullName']);
  });

  it('createMany: campos del primer registro', () => {
    expect(extractChangedFields('createMany', { data: [{ a: 1, b: 2 }] }).sort()).toEqual(['a', 'b']);
    expect(extractChangedFields('createMany', { data: [] })).toEqual([]);
  });

  it('update / updateMany: campos del data', () => {
    expect(extractChangedFields('update', { data: { phone: '+549...' } })).toEqual(['phone']);
    expect(extractChangedFields('updateMany', { data: { consent: false, consentAt: new Date() } }).sort()).toEqual(
      ['consent', 'consentAt']
    );
  });

  it('upsert: unión de create y update', () => {
    const fields = extractChangedFields('upsert', {
      create: { dni: '1', fullName: 'x' },
      update: { phone: '2' },
    });
    expect(fields.sort()).toEqual(['dni', 'fullName', 'phone']);
  });

  it('delete / deleteMany: sin campos', () => {
    expect(extractChangedFields('delete', { where: { id: '1' } })).toEqual([]);
    expect(extractChangedFields('deleteMany', { where: {} })).toEqual([]);
  });
});
