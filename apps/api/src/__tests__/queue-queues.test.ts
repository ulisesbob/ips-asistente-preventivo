import { describe, it, expect } from 'vitest';
import {
  QUEUE_NAMES,
  controlSingletonKey,
  medicationSingletonKey,
  selfSingletonKey,
  followupSingletonKey,
  surveySingletonKey,
} from '../queue/queues';

// ─── T4 — queue/queues.ts ─────────────────────────────────────────────────────
// Constantes con nombres de cola + builders PUROS de singletonKey.
// Idempotencia capa 1: misma entrada → misma clave (no encolar dos veces).

describe('queue/queues — nombres de cola', () => {
  it('expone los 6 nombres de cola esperados', () => {
    expect(QUEUE_NAMES.control).toBe('reminders:control');
    expect(QUEUE_NAMES.medication).toBe('reminders:medication');
    expect(QUEUE_NAMES.self).toBe('reminders:self');
    expect(QUEUE_NAMES.followup).toBe('reminders:followup');
    expect(QUEUE_NAMES.survey).toBe('reminders:survey');
    expect(QUEUE_NAMES.dead).toBe('reminders:dead');
  });
});

describe('queue/queues — builders de singletonKey (puras y deterministas)', () => {
  it('control: control:{patientProgramId}:{YYYY-MM-DD}', () => {
    expect(controlSingletonKey('pp-1', '2026-05-20')).toBe('control:pp-1:2026-05-20');
  });

  it('control es determinista (misma entrada → misma clave)', () => {
    expect(controlSingletonKey('pp-1', '2026-05-20')).toBe(
      controlSingletonKey('pp-1', '2026-05-20')
    );
  });

  it('control distingue por día (idempotencia diaria, no global)', () => {
    expect(controlSingletonKey('pp-1', '2026-05-20')).not.toBe(
      controlSingletonKey('pp-1', '2026-05-21')
    );
  });

  it('medication: medication:{reminderId}:{YYYY-MM-DD}:{HH:MM} (slot por día)', () => {
    expect(medicationSingletonKey('med-1', '2026-05-20', 8, 30)).toBe(
      'medication:med-1:2026-05-20:08:30'
    );
  });

  it('medication zero-padea hora y minuto', () => {
    expect(medicationSingletonKey('med-1', '2026-05-20', 9, 0)).toBe(
      'medication:med-1:2026-05-20:09:00'
    );
  });

  it('medication distingue por slot horario dentro del mismo día', () => {
    expect(medicationSingletonKey('med-1', '2026-05-20', 8, 0)).not.toBe(
      medicationSingletonKey('med-1', '2026-05-20', 8, 30)
    );
  });

  it('self: self:{selfReminderId}:{YYYY-MM-DD}', () => {
    expect(selfSingletonKey('sr-1', '2026-05-20')).toBe('self:sr-1:2026-05-20');
  });

  it('followup: followup:{patientId}:{YYYY-MM-DD}', () => {
    expect(followupSingletonKey('pat-1', '2026-05-20')).toBe('followup:pat-1:2026-05-20');
  });

  it('survey: survey:{surveyId} (una sola vez, sin fecha)', () => {
    expect(surveySingletonKey('surv-1')).toBe('survey:surv-1');
  });

  it('survey es determinista', () => {
    expect(surveySingletonKey('surv-1')).toBe(surveySingletonKey('surv-1'));
  });
});
