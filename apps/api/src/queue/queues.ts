/**
 * Nombres de cola, tipos de payload y builders de singletonKey (Bloque B).
 *
 * INERTE: este módulo es 100% declarativo + funciones puras. No abre conexiones,
 * no arranca pg-boss, no envía nada. Sólo describe el contrato de las colas para
 * que los productores (crons, T7+) y el worker (T6) compartan nombres y claves.
 *
 * Idempotencia capa 1 (no encolar dos veces): la `singletonKey` se deriva de la
 * identidad natural del recordatorio + la ventana temporal en la que aplica.
 * pg-boss garantiza que, dentro de su política singleton, no haya dos jobs activos
 * con la misma clave. La capa 2 (no aplicar el efecto dos veces) vive en el handler
 * de cada cron (T7+), no acá.
 */

/** Nombres de cola en pg-boss. `dead` recibe los jobs agotados (dead-letter). */
export const QUEUE_NAMES = {
  control: 'reminders:control',
  medication: 'reminders:medication',
  self: 'reminders:self',
  followup: 'reminders:followup',
  survey: 'reminders:survey',
  dead: 'reminders:dead',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ─── Payloads ─────────────────────────────────────────────────────────────────
// Mínimos y serializables (van a JSONB en pg-boss). El worker re-deriva el texto
// con un buildMessage por cola; el guard idempotente lee la DB por estos IDs.

/** Control de programa (reminder.service). Avanza nextReminderDate → 1 por día. */
export interface ControlJobPayload {
  patientProgramId: string;
  patientId: string;
  phone: string;
  /** YYYY-MM-DD del día del recordatorio (zona Argentina). */
  date: string;
}

/** Recordatorio de medicación. Slot horario (hora:minuto) por día. */
export interface MedicationJobPayload {
  reminderId: string;
  patientId: string;
  phone: string;
  date: string;
  reminderHour: number;
  reminderMinute: number;
}

/** Self-reminder del paciente. 1 por recordatorio por día. */
export interface SelfJobPayload {
  selfReminderId: string;
  patientId: string;
  phone: string;
  date: string;
}

/** Followup a paciente sin programa. 1 por paciente por día. */
export interface FollowupJobPayload {
  patientId: string;
  phone: string;
  date: string;
}

/** Encuesta post-control. 1 por encuesta (sin fecha: se manda una sola vez). */
export interface SurveyJobPayload {
  surveyId: string;
  patientId: string;
  phone: string;
}

// ─── Builders de singletonKey (PUROS, deterministas) ──────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** control:{patientProgramId}:{YYYY-MM-DD} */
export function controlSingletonKey(patientProgramId: string, date: string): string {
  return `control:${patientProgramId}:${date}`;
}

/** medication:{reminderId}:{YYYY-MM-DD}:{HH:MM} */
export function medicationSingletonKey(
  reminderId: string,
  date: string,
  reminderHour: number,
  reminderMinute: number
): string {
  return `medication:${reminderId}:${date}:${pad2(reminderHour)}:${pad2(reminderMinute)}`;
}

/** self:{selfReminderId}:{YYYY-MM-DD} */
export function selfSingletonKey(selfReminderId: string, date: string): string {
  return `self:${selfReminderId}:${date}`;
}

/** followup:{patientId}:{YYYY-MM-DD} */
export function followupSingletonKey(patientId: string, date: string): string {
  return `followup:${patientId}:${date}`;
}

/** survey:{surveyId} (una sola vez, sin ventana temporal). */
export function surveySingletonKey(surveyId: string): string {
  return `survey:${surveyId}`;
}
