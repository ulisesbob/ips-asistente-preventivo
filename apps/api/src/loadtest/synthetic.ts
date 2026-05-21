/**
 * Builders PUROS de datos sintéticos para el test de carga de 40k (Bloque B).
 *
 * Decisión de diseño: en vez de agregar una columna `isSynthetic` al schema (lo
 * que sería una migración que viaja a producción), marcamos los sintéticos por
 * CONVENCIÓN de DNI (`LOADTEST-*`). Los DNIs reales argentinos son numéricos, así
 * que el prefijo NUNCA colisiona con un paciente real → el cleanup
 * (`DELETE WHERE dni LIKE 'LOADTEST-%'`) es seguro para los ~550 reales. Cero
 * cambios de schema/prod: el harness es 100% tooling.
 *
 * El harness targetea el cron de FOLLOWUP por ser el más simple de seedear (solo
 * pacientes, sin programas/doctores) y el patrón ya validado — así el test aísla
 * la INFRA de cola (productor paginado + worker + limiter + idempotencia) que los
 * 5 crons comparten.
 */

/** Prefijo de DNI que identifica datos sintéticos. No-numérico → no colisiona. */
export const SYNTHETIC_DNI_PREFIX = 'LOADTEST-';

/** Antigüedad (días) del createdAt sintético. Debe superar el grace de followup
 * (GRACE_PERIOD_DAYS = 7 en patient-followup.service) para ser candidato HOY. */
export const GRACE_DAYS_AHEAD_OF_FOLLOWUP = 30;

export interface SyntheticPatientSeed {
  dni: string;
  phone: string;
  fullName: string;
  consent: boolean;
  whatsappLinked: boolean;
  /** RegisteredVia.BOT (string para no acoplar este módulo puro a @ips/db). */
  registeredVia: 'BOT';
  createdAt: Date;
}

/** DNI sintético estable por índice: LOADTEST-00000042. */
export function syntheticDni(i: number): string {
  return `${SYNTHETIC_DNI_PREFIX}${String(i).padStart(8, '0')}`;
}

/**
 * Teléfono sintético único por índice, en un rango RESERVADO (arranca con 5490,
 * "área 90" imposible para un móvil argentino real) → no colisiona con el unique
 * de `phone` ni con un número real.
 */
export function syntheticPhone(i: number): string {
  return `5490${String(i).padStart(9, '0')}`;
}

/** True si el DNI corresponde a un paciente sintético del test de carga. */
export function isSyntheticDni(dni: string): boolean {
  return dni.startsWith(SYNTHETIC_DNI_PREFIX);
}

/**
 * Construye el seed de un paciente sintético candidato a followup HOY:
 * BOT-registrado, con consent, whatsappLinked, phone, y createdAt suficientemente
 * antiguo (supera el grace de 7 días). Sin programas → cae en el followup.
 */
export function buildSyntheticPatient(i: number, now: Date = new Date()): SyntheticPatientSeed {
  const createdAt = new Date(
    now.getTime() - GRACE_DAYS_AHEAD_OF_FOLLOWUP * 24 * 60 * 60 * 1000
  );
  return {
    dni: syntheticDni(i),
    phone: syntheticPhone(i),
    fullName: `LoadTest Patient ${i}`,
    consent: true,
    whatsappLinked: true,
    registeredVia: 'BOT',
    createdAt,
  };
}
