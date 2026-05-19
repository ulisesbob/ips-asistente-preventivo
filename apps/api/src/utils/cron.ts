import cron from 'node-cron';
import { logger } from './logger';

/**
 * Wrapper común para crons del proyecto. Antes había 3 archivos (medication-cron,
 * self-reminder-cron, survey-cron) con scaffolding casi idéntico: variable
 * `task`, variable `running`, guard de overlap, try/catch/finally, log de inicio.
 * Acá lo unificamos — cada cron solo declara label + schedule + work.
 *
 * Garantías:
 * - Skip si la corrida anterior sigue en progreso (no overlap)
 * - Try/catch logueado, finally siempre libera running
 * - Timezone Argentina por default
 * - Log estructurado de inicio
 *
 * Retorna { start, stop } para manejo del lifecycle.
 */
export interface ScheduledJobOptions {
  /** Label corto para los logs, ej "[MedCron]". */
  label: string;
  /** Cron expression válida (ej "0,30 * * * *"). */
  schedule: string;
  /** Función a ejecutar. Si devuelve { sent, failed }, se loguean. */
  work: () => Promise<{ sent: number; failed: number } | void>;
  /** Override de timezone (default Argentina). */
  timezone?: string;
}

export interface ScheduledJob {
  start(): void;
  stop(): void;
}

export function createScheduledJob(opts: ScheduledJobOptions): ScheduledJob {
  let task: cron.ScheduledTask | null = null;
  let running = false;

  return {
    start(): void {
      task = cron.schedule(
        opts.schedule,
        async () => {
          if (running) {
            logger.warn(`${opts.label} Previous run still in progress, skipping`);
            return;
          }
          running = true;
          try {
            const result = await opts.work();
            if (result && (result.sent > 0 || result.failed > 0)) {
              logger.info(`${opts.label} Run complete`, {
                event: 'cron_run',
                label: opts.label,
                sent: result.sent,
                failed: result.failed,
              });
            }
          } catch (err) {
            logger.error(`${opts.label} Error during run`, {
              event: 'cron_error',
              label: opts.label,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            running = false;
          }
        },
        { timezone: opts.timezone ?? 'America/Argentina/Buenos_Aires' }
      );
      logger.info(`${opts.label} Cron scheduled "${opts.schedule}"`, {
        event: 'cron_start',
        label: opts.label,
        schedule: opts.schedule,
      });
    },
    stop(): void {
      if (task) {
        task.stop();
        task = null;
      }
    },
  };
}
