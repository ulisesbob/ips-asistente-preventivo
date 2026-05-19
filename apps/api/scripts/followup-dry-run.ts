/**
 * Dry-run del cron de followup.
 *
 * Muestra qué pacientes recibirían un mensaje HOY sin enviar nada.
 * Útil para verificar contra DB real (dev/staging/prod) antes de confiar
 * en el cron automático.
 *
 * Uso:
 *   npm run followup:dry-run -w @ips/api
 *
 * O directo:
 *   DATABASE_URL=... npx tsx scripts/followup-dry-run.ts
 */
import { prisma } from '@ips/db';
import {
  findPatientsNeedingFollowup,
  findAbandonedPatients,
  GRACE_PERIOD_DAYS,
  MAX_FOLLOWUPS,
} from '../src/services/patient-followup.service';

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(d);
}

function maskPhone(phone: string | null): string {
  if (!phone) return '(no phone)';
  return `***${phone.slice(-4)}`;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  FOLLOWUP DRY-RUN — qué pacientes recibirían mensaje HOY');
  console.log(`  Reglas: registrado por BOT, sin programa activo,`);
  console.log(`          >=${GRACE_PERIOD_DAYS} días desde registro, <${MAX_FOLLOWUPS} reminders enviados`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const candidatos = await findPatientsNeedingFollowup();
  if (candidatos.length === 0) {
    console.log('✅ Cero candidatos elegibles hoy.');
  } else {
    console.log(`📨 ${candidatos.length} pacientes recibirían mensaje hoy:`);
    console.log('');
    console.log('  Nombre               Phone         Registro        Reminders enviados');
    console.log('  ' + '─'.repeat(76));
    for (const p of candidatos) {
      const name = p.fullName.padEnd(20).slice(0, 20);
      const phone = maskPhone(p.phone).padEnd(13);
      const reg = fmtDate(p.createdAt).padEnd(15);
      const count = `${p.noProgramReminderCount}/${MAX_FOLLOWUPS}`;
      console.log(`  ${name} ${phone} ${reg} ${count}`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ABANDONED — pacientes con 3 reminders sin inscribirse');
  console.log('  (estos requieren acción manual del admin)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const abandonados = await findAbandonedPatients();
  if (abandonados.length === 0) {
    console.log('✅ Sin abandonados.');
  } else {
    console.log(`⚠️ ${abandonados.length} pacientes abandonados:`);
    console.log('');
    console.log('  Nombre               DNI        Registro        Último reminder');
    console.log('  ' + '─'.repeat(76));
    for (const p of abandonados) {
      const name = p.fullName.padEnd(20).slice(0, 20);
      const dni = `***${p.dni.slice(-3)}`.padEnd(10);
      const reg = fmtDate(p.createdAt).padEnd(15);
      const last = p.lastNoProgramReminderAt
        ? fmtDate(p.lastNoProgramReminderAt)
        : '(nunca)';
      console.log(`  ${name} ${dni} ${reg} ${last}`);
    }
  }

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ℹ️  Esto es DRY-RUN. Para ejecutar el cron real, esperar al');
  console.log('     próximo slot diario (10:30 AM Argentina) o reiniciar el');
  console.log('     server (los crons arrancan tras el warmUp).');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((err) => {
    console.error('Error en dry-run:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
