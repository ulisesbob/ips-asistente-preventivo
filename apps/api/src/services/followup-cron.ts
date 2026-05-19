import { processFollowups } from './patient-followup.service';
import { createScheduledJob } from '../utils/cron';

/**
 * Followup cron — daily 10:30 AM Argentina.
 *
 * Procesa pacientes registrados por bot que llevan >=7 días sin programa.
 * Les manda hasta 3 recordatorios espaciados (cada 7 días) para que se
 * acerquen al IPS a inscribirse.
 *
 * Slot a las 10:30 (no 10:00 como survey-cron) para no saturar Meta/Twilio.
 */
const job = createScheduledJob({
  label: '[FollowupCron]',
  schedule: '30 10 * * *',
  work: processFollowups,
});

export function startFollowupCron(): void {
  job.start();
}

export function stopFollowupCron(): void {
  job.stop();
}
