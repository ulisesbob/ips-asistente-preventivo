import { prisma } from '@ips/db';
import { sendTextMessage } from './messaging.service';
import { maskPhone, firstName } from '../utils/pii';
import { toMetaSendablePhone } from '../utils/phone';
import { createScheduledJob } from '../utils/cron';

const SURVEY_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_PER_RUN = 100;
const RATE_LIMIT_MS = 100;

/**
 * Encuentra y dispatcha encuestas pendientes (controles marcados >24h sin enviar).
 * Extraído como función para que createScheduledJob (utils/cron.ts) lo wrappee
 * con el running guard + logging consistente con los otros 3 crons.
 */
async function processPendingSurveys(): Promise<{ sent: number; failed: number }> {
  const cutoff = new Date(Date.now() - SURVEY_CUTOFF_MS);

  const pendingSurveys = await prisma.survey.findMany({
    where: {
      createdAt: { lt: cutoff },
      dispatchedAt: null,
      completedAt: null,
      patient: {
        consent: true,
        phone: { not: null },
      },
    },
    take: MAX_PER_RUN,
    select: {
      id: true,
      patient: { select: { fullName: true, phone: true } },
      patientProgram: { select: { program: { select: { name: true } } } },
    },
  });

  if (pendingSurveys.length === 0) {
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const survey of pendingSurveys) {
    if (!survey.patient.phone) continue;
    const sendPhone = toMetaSendablePhone(survey.patient.phone);
    const greetName = firstName(survey.patient.fullName);
    const programName = survey.patientProgram.program.name;

    const message =
      `Hola ${greetName}! Queremos saber cómo te fue con tu control de *${programName}*.\n\n` +
      `¿Pudiste realizar tu control?\n` +
      `Respondé *Sí* o *No*`;

    try {
      await sendTextMessage(sendPhone, message);
      await prisma.survey.update({
        where: { id: survey.id },
        data: { dispatchedAt: new Date() },
      });
      sent++;
    } catch (err) {
      console.error(`[SurveyCron] Error sending to ${maskPhone(sendPhone)}:`, err);
      failed++;
    }

    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_MS));
  }

  return { sent, failed };
}

const job = createScheduledJob({
  label: '[SurveyCron]',
  schedule: '0 10 * * *', // diario 10:00 AM Argentina
  work: processPendingSurveys,
});

export function startSurveyCron(): void {
  job.start();
}

export function stopSurveyCron(): void {
  job.stop();
}
