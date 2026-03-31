import cron from 'node-cron';
import { prisma } from '@ips/db';
import { sendTextMessage } from './whatsapp.service';
import { logger } from '../utils/logger';

let task: cron.ScheduledTask | null = null;
let running = false;

/**
 * Survey dispatch cron — runs daily at 10:00 AM Argentina.
 * Sends survey WhatsApp messages for controls marked >24h ago that haven't been dispatched.
 */
export function startSurveyCron(): void {
  task = cron.schedule('0 10 * * *', async () => {
    if (running) return;
    running = true;

    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

      // Find surveys created >24h ago, not yet completed, for patients with phone + consent
      const pendingSurveys = await prisma.survey.findMany({
        where: {
          sentAt: { lt: cutoff },
          completedAt: null,
          attended: null, // not yet answered step 1
          patient: {
            consent: true,
            phone: { not: null },
          },
        },
        take: 100, // LESSONS #13
        select: {
          id: true,
          patient: {
            select: {
              fullName: true,
              phone: true,
            },
          },
          patientProgram: {
            select: {
              program: { select: { name: true } },
            },
          },
        },
      });

      if (pendingSurveys.length === 0) {
        return;
      }

      let sent = 0;
      let failed = 0;

      for (const survey of pendingSurveys) {
        if (!survey.patient.phone) continue;

        // Normalize phone for Argentina (LESSONS #40)
        let sendPhone = survey.patient.phone.startsWith('+')
          ? survey.patient.phone.slice(1)
          : survey.patient.phone;
        if (sendPhone.startsWith('549') && sendPhone.length === 13) {
          sendPhone = '54' + sendPhone.slice(3);
        }

        const firstName = survey.patient.fullName.split(' ')[0];
        const programName = survey.patientProgram.program.name;

        const message =
          `Hola ${firstName}! Queremos saber cómo te fue con tu control de *${programName}*.\n\n` +
          `¿Pudiste realizar tu control?\n` +
          `Respondé *Sí* o *No*`;

        try {
          await sendTextMessage(sendPhone, message);
          sent++;
        } catch (err) {
          console.error(`[SurveyCron] Error sending to ${sendPhone}:`, err);
          failed++;
        }

        await new Promise((resolve) => setTimeout(resolve, 100)); // rate limit
      }

      if (sent > 0 || failed > 0) {
        logger.info('[SurveyCron] Survey dispatch complete', {
          event: 'survey_cron',
          sent,
          failed,
        });
      }
    } catch (err) {
      logger.error('[SurveyCron] Error in survey cron', {
        event: 'survey_cron_error',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }, {
    timezone: 'America/Argentina/Buenos_Aires',
  });

  logger.info('[SurveyCron] Survey dispatch cron started (daily 10:00 AM Argentina)');
}

export function stopSurveyCron(): void {
  if (task) {
    task.stop();
    task = null;
  }
}
