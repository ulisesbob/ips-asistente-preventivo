import {
  prisma,
  ConversationStatus,
  MessageRole,
  RegisteredVia,
  ConsentVia,
  PatientProgramStatus,
  Role,
} from '@ips/db';
import { sendTextMessage } from './messaging.service';
import { generateResponse, buildSystemPrompt, ChatMessage, MAX_HISTORY_MESSAGES } from './ai.service';
import { responseLeaksNotes } from '../utils/note-leak';
import { getLatestNotesForBot } from './note.service';
import { getRelevantKBForBot } from './knowledge.service';
import { processSurveyResponse } from './survey.service';
import { getMedicationsForBot, createMedReminderFromBot } from './medication-reminder.service';
import {
  getSelfRemindersForBot,
  createSelfReminder,
  listActiveSelfReminders,
  cancelSelfReminder,
  parseSelfReminderTag,
  parseListRemindersTag,
  parseCancelReminderTag,
  formatRemindersForWhatsApp,
} from './self-reminder.service';
import { maskId, maskPhone, firstName } from '../utils/pii';
import { config } from '../config/env';
import { NotFoundError, ValidationError } from '../utils/errors';

// ─── Constants ────────────────────────────────────────────────────────────────

// DNI argentino: 6 a 8 dígitos, primer dígito NO puede ser 0 (audit #23 + code-review).
// 6 dígitos = personas nacidas antes de ~1930 (todavía vivas en padrón de salud crónica).
// 7 dígitos = generaciones medias, 8 dígitos = post-1990. Rango: 100.000-99.999.999.
const DNI_REGEX = /^[1-9]\d{5,7}$/;
const E164_PHONE_REGEX = /^\d{7,15}$/;
const REGISTRATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_FOR_DB = 20; // Align with AI service MAX_HISTORY_MESSAGES
// If an ESCALATED conversation has no operator activity in this window, auto-reopen
// so the patient isn't stuck waiting forever (audit #16).
const ESCALATION_STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Escalation keywords — patient wants to talk to a human (pre-normalized, no accents)
const ESCALATION_KEYWORDS = [
  'operador', 'operadora', 'hablar con alguien', 'persona real',
  'quiero hablar', 'agente', 'humano', 'atencion humana',
  'necesito ayuda', 'no me sirve', 'reclamar', 'reclamo', 'queja',
];

// Reminder keywords — patient wants to CREATE a reminder (pre-normalized, no accents)
// Use phrases that imply intent to create, not just mention the word "recordatorio"
const REMINDER_KEYWORDS = [
  'recordame',                    // "recordame tomar la pastilla"
  'recuerdame',                   // "recuérdame..."
  'avisame',                      // "avisame a las 8"
  'quiero un recordatorio',       // explicit intent
  'poneme un recordatorio',       // explicit intent
  'crear recordatorio',           // explicit intent
  'haceme un recordatorio',       // explicit intent
  'necesito un recordatorio',     // explicit intent
];
// Note: "recordatorio" alone is NOT here — "ya tengo un recordatorio" must NOT trigger the flow

// Phone normalization centralizada en utils/phone.ts (LESSONS #40).
import { toMetaSendablePhone as toSendablePhone } from '../utils/phone';

// BUG 1: el bot quedaba mudo ante mensajes que no son texto (audio, imagen,
// sticker, ubicación, documento). Respondemos UNA vez con esta guía cálida y
// NO procesamos el contenido (sin IA, sin registro). El público es mayormente
// adulto mayor, así que el tono es simple y amable.
const UNSUPPORTED_CONTENT_MESSAGE =
  'Por ahora solo puedo leer mensajes de *texto* 🙏. ' +
  'Escribime tu consulta por palabras y te ayudo.';

// PII masking centralized in utils/pii.ts (see audit #24).

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationState {
  step: 'AWAITING_NAME' | 'AWAITING_DNI';
  tempName?: string;
  createdAt: number;
}

interface ReminderFlowState {
  step: 'AWAITING_DESCRIPTION' | 'AWAITING_TIME';
  description?: string;
  createdAt: number;
}

// In-memory state for registration flows (keyed by phone).
// This is safe because registration is a short-lived flow (2-3 messages).
// If the server restarts mid-registration, the user just starts over.
const registrationState = new Map<string, ConversationState>();
const reminderFlowState = new Map<string, ReminderFlowState>();

// Periodic cleanup of stale entries
setInterval(() => {
  const now = Date.now();
  for (const [phone, state] of registrationState.entries()) {
    if (now - state.createdAt > REGISTRATION_TTL_MS) {
      registrationState.delete(phone);
    }
  }
  for (const [phone, state] of reminderFlowState.entries()) {
    if (now - state.createdAt > REGISTRATION_TTL_MS) {
      reminderFlowState.delete(phone);
    }
  }
}, 10 * 60 * 1000); // every 10 minutes

function getRegistrationState(phone: string): ConversationState | undefined {
  const state = registrationState.get(phone);
  if (!state) return undefined;
  if (Date.now() - state.createdAt > REGISTRATION_TTL_MS) {
    registrationState.delete(phone);
    return undefined; // treat as fresh start
  }
  return state;
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function handleIncomingMessage(
  phone: string,
  text: string,
  _displayName: string,
  isUnsupported = false
): Promise<void> {
  // Normalize phone: ensure no + prefix (Meta sends without it)
  const normalizedPhone = phone.startsWith('+') ? phone.slice(1) : phone;

  // Validate phone format
  if (!E164_PHONE_REGEX.test(normalizedPhone)) {
    console.warn(`[WhatsApp] Número de teléfono inválido ignorado: ${maskPhone(phone)}`);
    return;
  }

  // For DB storage, use E.164 with +
  const e164Phone = `+${normalizedPhone}`;

  // BUG 1: contenido NO-texto (audio/imagen/sticker/ubicación/documento). El
  // dedup ya ocurrió en el webhook (Twilio/Meta), así que respondemos UNA sola
  // vez con la guía y cortamos: no IA, no registro, no flujos.
  if (isUnsupported) {
    await handleUnsupportedMessage(normalizedPhone, e164Phone);
    return;
  }

  // 1. Check if patient exists by phone
  const patient = await prisma.patient.findUnique({
    where: { phone: e164Phone },
    select: {
      id: true,
      fullName: true,
      consent: true,
      whatsappLinked: true,
      programs: {
        where: { status: PatientProgramStatus.ACTIVE },
        select: {
          lastControlDate: true,
          nextReminderDate: true,
          program: {
            select: { name: true, centers: true, reminderFrequencyDays: true },
          },
        },
      },
    },
  });

  // 2. Handle "BAJA" command — works for registered patients only
  if (patient && text.trim().toUpperCase() === 'BAJA') {
    await handleBaja(normalizedPhone, e164Phone, patient.id);
    return;
  }

  // 3. Handle "ALTA" command — re-enable consent
  if (patient && text.trim().toUpperCase() === 'ALTA') {
    await handleAlta(normalizedPhone, e164Phone, patient.id);
    return;
  }

  // 3.5. Auto-link patients imported by CSV/panel (no WhatsApp linked yet).
  // Then fall through to the normal flow so escalation/BAJA/etc. work on first message.
  if (patient && !patient.whatsappLinked) {
    await autoLinkPatient(normalizedPhone, e164Phone, patient);
    if (!patient.consent) return; // opted out — linked silently, don't process further
    patient.whatsappLinked = true; // local mutation so the next branch runs
  }

  // 4. Pending survey response — chequear PRIMERO (antes de ESCALATED) para
  // que las encuestas no queden colgadas si el paciente está en escalación
  // activa. Si responde "sí" o "5" a una encuesta pendiente, lo procesamos
  // aunque haya un operador atendiendo otro tema.
  if (patient && patient.whatsappLinked) {
    const surveyReply = await processSurveyResponse(patient.id, text);
    if (surveyReply) {
      await saveMessageAndReply(normalizedPhone, e164Phone, patient.id, text, surveyReply);
      return;
    }
  }

  // 5. Check if conversation is ESCALATED — don't respond with AI, just save message
  if (patient && patient.whatsappLinked) {
    const activeConv = await prisma.conversation.findFirst({
      where: { phone: e164Phone, status: ConversationStatus.ESCALATED },
      select: {
        id: true,
        // Look at the last NON-USER message: either the bot's "voy a derivar" ack
        // (sent at escalation time) OR an operator reply. Both serve as the baseline
        // for "is the operator still engaging?". If neither exists (extreme edge),
        // default to NOT stale so we don't drop someone who just escalated.
        messages: {
          where: { role: { in: [MessageRole.ASSISTANT, MessageRole.SYSTEM] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    });

    if (activeConv) {
      // Auto-reopen if operator has been silent for too long (audit #16).
      // Without this the patient is stuck forever — every future message gets
      // saved and ignored.
      const lastNonUserMsgAt = activeConv.messages[0]?.createdAt;
      const isStale =
        !!lastNonUserMsgAt &&
        Date.now() - lastNonUserMsgAt.getTime() > ESCALATION_STALE_MS;

      if (isStale) {
        await prisma.conversation.update({
          where: { id: activeConv.id },
          data: { status: ConversationStatus.OPEN },
        });
        console.log(
          `[Escalation] Auto-reopened stale ESCALATED conv ${activeConv.id} (patient ${maskId(patient.id)})`
        );
        // Fall through to normal handlers (reminder flow / AI chat).
      } else {
        // Operator is actively handling — save patient message, don't respond.
        await prisma.message.create({
          data: { conversationId: activeConv.id, role: MessageRole.USER, content: text },
        });
        return;
      }
    }

    // 6. Check for active reminder flow (step-by-step, no AI needed)
    const reminderFlow = reminderFlowState.get(normalizedPhone);
    if (reminderFlow) {
      await handleReminderFlow(normalizedPhone, e164Phone, patient.id, text, reminderFlow);
      return;
    }

    // 7. Check for escalation keywords
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wantsHuman = ESCALATION_KEYWORDS.some((kw) => textLower.includes(kw));

    if (wantsHuman) {
      await handleEscalation(normalizedPhone, e164Phone, patient.id, text);
      return;
    }

    // 8. Check for reminder intent keywords → start reminder flow
    const wantsReminder = REMINDER_KEYWORDS.some((kw) => textLower.includes(kw));
    if (wantsReminder) {
      await startReminderFlow(normalizedPhone, e164Phone, patient.id, text);
      return;
    }

    // 9. Normal chat mode
    await handleChat(normalizedPhone, e164Phone, patient, text);
    return;
  }

  // 6. Not found → registration flow
  await handleRegistration(normalizedPhone, e164Phone, text);
}

/**
 * Auto-link patient on first WhatsApp contact (was imported by CSV/panel without
 * having linked their WA number yet). Sends a one-time greeting and returns so
 * the caller can fall through to the normal handler chain.
 *
 * Audit #17: previously this branch short-circuited and ignored escalation
 * keywords, BAJA, surveys, etc. Now we greet + fall through.
 */
async function autoLinkPatient(
  normalizedPhone: string,
  e164Phone: string,
  patient: { id: string; fullName: string; consent: boolean; programs: Array<{ program: { name: string } }> }
): Promise<void> {
  // Atomic check-and-update so two concurrent webhooks don't both send the
  // welcome greeting. Whoever wins the race flips whatsappLinked false→true
  // and runs the greeting; the loser gets P2025 and silently returns.
  // Select consent in the same query so we use the FRESH value (no TOCTOU
  // between snapshot read and post-update greeting — security-auditor finding).
  const updated = await prisma.patient
    .update({
      where: { id: patient.id, whatsappLinked: false },
      data: { whatsappLinked: true },
      select: { id: true, consent: true },
    })
    .catch((err: { code?: string }) => {
      if (err.code === 'P2025') return null; // already linked by concurrent request
      throw err;
    });

  if (!updated) return; // concurrent request already greeted this patient

  if (!updated.consent) return; // opted out — link silently (use fresh consent)

  const greeting =
    patient.programs.length > 0
      ? `Hola ${firstName(patient.fullName)}! Soy el asistente virtual del IPS. ` +
        `Estás inscripto/a en: ${patient.programs.map((pp) => pp.program.name).join(', ')}.`
      : `Hola ${firstName(patient.fullName)}! Soy el asistente virtual del IPS. ` +
        `Ya estás registrado/a.`;

  // Greeting as ASSISTANT message; the user's actual message gets saved by
  // whatever handler runs in the normal flow.
  const conversation = await getOrCreateConversation(e164Phone, patient.id);
  await prisma.message.create({
    data: { conversationId: conversation.id, role: MessageRole.ASSISTANT, content: greeting },
  });
  await sendTextMessage(toSendablePhone(normalizedPhone), greeting);
}

// ─── Unsupported (non-text) content handler ──────────────────────────────────
// BUG 1: audio/imagen/sticker/ubicación/documento. El bot quedaba mudo. Ahora
// guía al paciente UNA vez. NO dispara IA, registro ni flujos.

async function handleUnsupportedMessage(
  normalizedPhone: string,
  e164Phone: string
): Promise<void> {
  // Si hay un operador atendiendo (ESCALATED no-stale), no le pisamos la
  // conversación con la guía automática: solo dejamos constancia del mensaje
  // entrante. Mismo criterio que el flujo de texto cuando está escalado.
  const activeConv = await prisma.conversation.findFirst({
    where: { phone: e164Phone, status: ConversationStatus.ESCALATED },
    select: {
      id: true,
      messages: {
        where: { role: { in: [MessageRole.ASSISTANT, MessageRole.SYSTEM] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (activeConv) {
    const lastNonUserMsgAt = activeConv.messages[0]?.createdAt;
    const isStale =
      !!lastNonUserMsgAt &&
      Date.now() - lastNonUserMsgAt.getTime() > ESCALATION_STALE_MS;

    if (!isStale) {
      // Operador activo: registramos el mensaje no-texto sin responder.
      await prisma.message.create({
        data: {
          conversationId: activeConv.id,
          role: MessageRole.USER,
          content: '[mensaje no-texto]',
        },
      });
      return;
    }
    // Si está stale, caemos al envío de guía de abajo (lo reabre el flujo de
    // texto en el próximo mensaje del paciente).
  }

  // Persist constancia + responder la guía UNA vez. El dedup del webhook ya
  // garantiza que este mensaje entrante se procesa una sola vez.
  await saveSystemMessage(e164Phone, null, '[mensaje no-texto]', UNSUPPORTED_CONTENT_MESSAGE);
  await sendTextMessage(toSendablePhone(normalizedPhone), UNSUPPORTED_CONTENT_MESSAGE);
}

// ─── Registration Flow ────────────────────────────────────────────────────────

async function handleRegistration(
  phone: string,
  e164Phone: string,
  text: string
): Promise<void> {
  const state = getRegistrationState(phone);

  // Step 1: First message ever — ask for name.
  // Send BEFORE advancing state so a transient WhatsApp failure doesn't strand
  // the patient with the bot expecting a name they were never asked for (audit #18).
  if (!state) {
    const greeting =
      'Hola! Soy el asistente virtual del IPS (Instituto de Previsión Social de Misiones). ' +
      'Para poder ayudarte, necesito algunos datos.\n\n' +
      '¿Cuál es tu nombre completo?';

    const sent = await sendTextMessage(toSendablePhone(phone), greeting);
    if (!sent) {
      console.warn(`[Registration] No se pudo enviar greeting a ${maskPhone(phone)} — no avanzo estado`);
      return; // patient will retry; next message will hit this branch again
    }
    await saveSystemMessage(e164Phone, null, text, greeting);
    registrationState.set(phone, { step: 'AWAITING_NAME', createdAt: Date.now() });
    return;
  }

  // Step 2: Received name — ask for DNI
  if (state.step === 'AWAITING_NAME') {
    const name = text.trim();

    if (name.length < 2 || name.length > 200) {
      const retry = 'El nombre debe tener entre 2 y 200 caracteres. ¿Cuál es tu nombre completo?';
      await sendTextMessage(toSendablePhone(phone), retry);
      return;
    }

    // Send the "ask for DNI" prompt BEFORE advancing state. If the WhatsApp send
    // fails, the patient stays in AWAITING_NAME and we'll retry on their next
    // message instead of silently moving them to AWAITING_DNI for a prompt they
    // never received (audit #18).
    const askDni = `Gracias, ${name}. ¿Cuál es tu número de DNI? (sin puntos)`;
    const sent = await sendTextMessage(toSendablePhone(phone), askDni);
    if (!sent) {
      console.warn(`[Registration] No se pudo enviar askDni a ${maskPhone(phone)} — no avanzo estado`);
      return;
    }
    registrationState.set(phone, { step: 'AWAITING_DNI', tempName: name, createdAt: state.createdAt });
    await saveMessages(e164Phone, null, text, askDni);
    return;
  }

  // Step 3: Received DNI — UPSERT patient, link phone
  if (state.step === 'AWAITING_DNI') {
    const dni = text.trim().replace(/\./g, '');

    if (!DNI_REGEX.test(dni)) {
      const retry = 'El DNI debe tener 6 a 8 dígitos. Por favor, ingresá tu DNI nuevamente:';
      await sendTextMessage(toSendablePhone(phone), retry);
      return;
    }

    // UPSERT by DNI — core deduplication logic
    const existing = await prisma.patient.findUnique({
      where: { dni },
      select: {
        id: true,
        fullName: true,
        phone: true,
        registeredVia: true,
        programs: {
          where: { status: PatientProgramStatus.ACTIVE },
          include: {
            program: { select: { name: true, centers: true } },
          },
        },
      },
    });

    let patientId: string;
    let patientName: string;
    let programNames: string[] = [];

    if (existing) {
      // SECURITY: 2 vectores de hijack se manejan con el MISMO mensaje genérico
      // (anti user-enumeration: no confirmar si el DNI existe ni en qué estado).
      //
      // (a) DNI ya vinculado a otro teléfono — alguien intenta reasignar.
      // (b) DNI sin teléfono Y fue cargado por PANEL/CSV — atacante con DNI
      //     real podría tomar control de la ficha. Solo BOT (registros previos
      //     via bot) se permite auto-link, porque ese paciente ya proporcionó
      //     su teléfono al registrarse y vino a través del flujo controlado.
      const otherPhoneLinked = existing.phone && existing.phone !== e164Phone;
      const panelCsvWithoutPhone =
        existing.phone === null && existing.registeredVia !== RegisteredVia.BOT;

      if (otherPhoneLinked || panelCsvWithoutPhone) {
        const reason = otherPhoneLinked ? 'phone_mismatch' : `panel_csv_no_phone(${existing.registeredVia})`;
        console.warn(
          `[Security] DNI ***${dni.slice(-3)} rejected (${reason}) from ${maskPhone(e164Phone)}.`
        );
        registrationState.delete(phone);
        // Mensaje único y deliberadamente vago. NO confirma existencia del DNI
        // ni el motivo exacto del rechazo — evita user enumeration.
        const rejection =
          `No pudimos validar tu identidad automáticamente. ` +
          `Acercate a una delegación del IPS con tu DNI para que un médico active tu WhatsApp. ` +
          `Para consultas: ${config.IPS_SUPPORT_PHONE}.`;
        await sendTextMessage(toSendablePhone(phone), rejection);
        return;
      }

      // Patient exists without phone or same phone — link it
      await prisma.patient.update({
        where: { dni },
        data: {
          phone: e164Phone,
          whatsappLinked: true,
          ...(!existing.fullName || existing.fullName.length < 2
            ? { fullName: state.tempName! }
            : {}),
        },
      });

      patientId = existing.id;
      patientName = existing.fullName;
      programNames = existing.programs.map((pp) => pp.program.name);
    } else {
      // New patient — create
      const newPatient = await prisma.patient.create({
        data: {
          fullName: state.tempName!,
          dni,
          phone: e164Phone,
          consent: true,
          // Trazabilidad: alta por el bot implica consentimiento dado vía WhatsApp.
          consentAt: new Date(),
          consentVia: ConsentVia.BOT,
          registeredVia: RegisteredVia.BOT,
          whatsappLinked: true,
        },
      });
      patientId = newPatient.id;
      patientName = state.tempName!;
    }

    // Clean up registration state
    registrationState.delete(phone);

    // Update conversation with patient link
    await linkConversationToPatient(e164Phone, patientId);

    // Build welcome message
    let welcome: string;
    if (programNames.length > 0) {
      welcome =
        `Listo, ${patientName}! Te encontré en nuestro sistema. ` +
        `Estás inscripto/a en: ${programNames.join(', ')}.\n\n` +
        `¿En qué puedo ayudarte?\n\n` +
        `Esta información es orientativa. Para consultas sobre su caso, comuníquese al ${config.IPS_SUPPORT_PHONE}.`;
    } else {
      // Onboarding explícito para no-programa: el paciente queda registrado pero
      // SIN inscripción a ningún programa. Le damos pasos claros para que se
      // acerque al IPS. El cron de followup se encarga de recordárselo cada 7
      // días si nadie lo inscribe (max 3 veces).
      welcome =
        `Listo, ${patientName}! Ya quedaste registrado/a en el sistema del IPS.\n\n` +
        `📋 *Próximo paso — inscripción en un programa*\n` +
        `Para que un médico te asigne a un programa de salud (diabetes, hipertensión, etc.):\n` +
        `1. Acercate al Área de Programas Especiales (Junín 177, Posadas) ` +
        `o a tu delegación más cercana.\n` +
        `2. Llevá DNI + carnet de afiliado.\n` +
        `3. Un médico te va a evaluar e inscribir.\n\n` +
        `Mientras tanto podés preguntarme cualquier consulta general sobre el IPS.\n\n` +
        `Esta información es orientativa. Para consultas, comuníquese al ${config.IPS_SUPPORT_PHONE}.`;
    }

    await saveMessages(e164Phone, patientId, text, welcome);
    await sendTextMessage(toSendablePhone(phone), welcome);
    return;
  }
}

// ─── Reminder Flow (step-by-step, no AI) ─────────────────────────────────────

async function startReminderFlow(
  phone: string,
  e164Phone: string,
  patientId: string,
  text: string
): Promise<void> {
  const msg =
    '¿Qué querés que te recuerde? Escribí una descripción corta.\n\n' +
    'Ejemplo: "Tomar insulina", "Tomar pastilla presión"';

  await saveMessageAndReply(phone, e164Phone, patientId, text, msg);
  reminderFlowState.set(phone, { step: 'AWAITING_DESCRIPTION', createdAt: Date.now() });
}

async function handleReminderFlow(
  phone: string,
  e164Phone: string,
  patientId: string,
  text: string,
  state: ReminderFlowState
): Promise<void> {
  // Allow escalation even mid-flow (regression fix: flow was blocking escalation)
  const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (ESCALATION_KEYWORDS.some((kw) => textLower.includes(kw))) {
    reminderFlowState.delete(phone);
    await handleEscalation(phone, e164Phone, patientId, text);
    return;
  }

  // "cancelar" exits the flow
  if (textLower === 'cancelar' || textLower === 'salir') {
    reminderFlowState.delete(phone);
    const msg = 'Listo, se canceló la creación del recordatorio. ¿En qué puedo ayudarte?';
    await saveMessageAndReply(phone, e164Phone, patientId, text, msg);
    return;
  }

  // Step 1: Got description → ask for time
  if (state.step === 'AWAITING_DESCRIPTION') {
    const desc = text.trim();
    if (desc.length < 2 || desc.length > 200) {
      const retry = 'La descripción debe tener entre 2 y 200 caracteres. ¿Qué querés que te recuerde?';
      await sendTextMessage(toSendablePhone(phone), retry);
      return;
    }

    reminderFlowState.set(phone, {
      step: 'AWAITING_TIME',
      description: desc,
      createdAt: state.createdAt,
    });

    const msg = `Perfecto: "${desc}"\n\n¿A qué hora querés que te avise todos los días? (formato: HH:MM, ejemplo: 08:00, 14:30)`;
    await saveMessageAndReply(phone, e164Phone, patientId, text, msg);
    return;
  }

  // Step 2: Got time → create MedicationReminder directly (same table the doctor uses)
  if (state.step === 'AWAITING_TIME') {
    const timeText = text.trim();
    const timeMatch = timeText.match(/(\d{1,2})[:\.](\d{2})/);

    if (!timeMatch) {
      const retry = 'No entendí la hora. Escribí en formato HH:MM, por ejemplo: 08:00, 14:30, 21:00';
      await sendTextMessage(toSendablePhone(phone), retry);
      return;
    }

    const hour = parseInt(timeMatch[1]);
    const minute = parseInt(timeMatch[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      const retry = 'La hora debe ser entre 00:00 y 23:59. Intentá de nuevo:';
      await sendTextMessage(toSendablePhone(phone), retry);
      return;
    }

    // Round minute to nearest 30 (medication cron runs at :00 and :30)
    const roundedMinute = minute < 15 ? 0 : 30;
    const wasRounded = roundedMinute !== minute;

    reminderFlowState.delete(phone);

    try {
      await createMedReminderFromBot(
        patientId,
        state.description!,
        'Según indicación médica',
        hour,
        roundedMinute
      );

      const timeDisplay = `${String(hour).padStart(2, '0')}:${String(roundedMinute).padStart(2, '0')}`;
      // Audit #25: si redondeamos la hora, decírselo explícitamente al paciente
      // (antes se cambiaba 8:15 → 8:30 sin avisar).
      const roundingNote = wasRounded
        ? ` (redondeé al horario más cercano porque los recordatorios van cada 30 min)`
        : '';
      const msg =
        `Listo! Te voy a recordar *"${state.description}"* todos los días a las ${timeDisplay} hs${roundingNote}.\n\n` +
        `El recordatorio aparece en tu ficha y tu médico también lo puede ver.`;
      await saveMessageAndReply(phone, e164Phone, patientId, text, msg);
    } catch (err) {
      const msg = `No pude crear el recordatorio: ${err instanceof Error ? err.message : 'Error'}`;
      await saveMessageAndReply(phone, e164Phone, patientId, text, msg);
    }
    return;
  }
}

// ─── Chat Mode ────────────────────────────────────────────────────────────────

async function handleChat(
  phone: string,
  e164Phone: string,
  patient: {
    id: string;
    fullName: string;
    consent: boolean;
    programs: Array<{
      lastControlDate: Date | null;
      nextReminderDate: Date;
      program: { name: string; centers: unknown; reminderFrequencyDays: number };
    }>;
  },
  text: string
): Promise<void> {
  // Fetch context for AI: notes + KB + medications + self-reminders
  const [notes, kbEntries, medications, selfReminders] = await Promise.all([
    getLatestNotesForBot(patient.id),
    getRelevantKBForBot(text),
    getMedicationsForBot(patient.id),
    getSelfRemindersForBot(patient.id),
  ]);

  // Build system prompt with patient context + notes
  const systemPrompt = buildSystemPrompt({
    fullName: patient.fullName,
    programs: patient.programs.map((pp) => ({
      name: pp.program.name,
      centers: pp.program.centers,
      reminderFrequencyDays: pp.program.reminderFrequencyDays,
      lastControlDate: pp.lastControlDate,
      nextReminderDate: pp.nextReminderDate,
    })),
    notes,
    knowledgeBase: kbEntries,
    medications,
    selfReminders,
  });

  // Debug: log what the AI will see
  console.log(`[Bot] Patient ${maskId(patient.id)} (${firstName(patient.fullName)}) has ${patient.programs.length} active programs, ${kbEntries.length} KB entries`);
  if (kbEntries.length > 0) {
    console.log('[Bot] KB entries:', kbEntries.map((e) => `[${e.category}] ${e.question.slice(0, 50)}`).join(' | '));
  } else {
    // Log length only — patient text may contain DNI/PII (audit #24 follow-up).
    console.warn(`[Bot] WARNING: No KB entries found (msg length: ${text.length} chars)`);
  }
  if (patient.programs.length > 0) {
    patient.programs.forEach((pp) => {
      console.log(`[Bot]   - ${pp.program.name}: next=${pp.nextReminderDate}, last=${pp.lastControlDate}`);
    });
  }

  // Get conversation history. Usamos el MISMO límite que ai.service (MAX_HISTORY_MESSAGES)
  // para no truncar más agresivo acá: antes cortaba a 6 y el bot olvidaba el contexto
  // a mitad de conversación pese a declarar 20 (audit #29), malo para crónicos.
  const conversation = await getOrCreateConversation(e164Phone, patient.id);
  const history = await getConversationHistory(conversation.id);

  const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);

  // Add user message to history for AI
  const messagesForAi: ChatMessage[] = [
    ...recentHistory,
    { role: 'user' as const, content: text },
  ];

  // Generate AI response
  let aiResponse: string;
  try {
    aiResponse = await generateResponse(systemPrompt, messagesForAi);
  } catch (error) {
    console.error('[AI] Error generando respuesta:', error);
    aiResponse =
      'Disculpá, estoy teniendo un problema técnico. ' +
      `Para consultas, comuníquese al ${config.IPS_SUPPORT_PHONE}.`;
  }

  // Server-side defense: el bot NUNCA debe filtrar notas operativas (audit #5).
  // Detección normalizada por acentos/puntuación/espacios (ver utils/note-leak).
  if (notes.length > 0) {
    const leaked = responseLeaksNotes(aiResponse, notes.map((n) => n.content));
    if (leaked) {
      console.warn(`[Security] AI response may contain leaked note content for patient ${maskId(patient.id)}. Replacing.`);
      aiResponse =
        'No tengo acceso a esa información. ' +
        '¿Hay algo más en lo que pueda ayudarte?\n\n' +
        `Esta información es orientativa. Para consultas sobre su caso, comuníquese al ${config.IPS_SUPPORT_PHONE}.`;
    }
  }

  // ─── Self-reminder tag processing ──────────────────────────────────────────
  // Parse and handle self-reminder tags BEFORE sending the response

  // 1. Check for create-reminder tag
  const reminderTag = parseSelfReminderTag(aiResponse);
  if (reminderTag.found && reminderTag.data) {
    aiResponse = reminderTag.cleanResponse;
    const result = await createSelfReminder(patient.id, reminderTag.data);
    if (!result.success) {
      aiResponse += `\n\n⚠️ ${result.message}`;
    }
  }

  // 2. Check for list-reminders tag
  const listTag = parseListRemindersTag(aiResponse);
  if (listTag.found) {
    const reminders = await listActiveSelfReminders(patient.id);
    aiResponse = listTag.cleanResponse + '\n\n' + formatRemindersForWhatsApp(reminders);
  }

  // 3. Check for cancel-reminder tag
  const cancelTag = parseCancelReminderTag(aiResponse);
  if (cancelTag.found && cancelTag.index !== undefined) {
    const result = await cancelSelfReminder(patient.id, cancelTag.index);
    aiResponse = cancelTag.cleanResponse;
    if (!result.success) {
      aiResponse += `\n\n⚠️ ${result.message}`;
    }
  }

  // Save both messages and send reply
  await saveMessagePair(conversation.id, text, aiResponse);
  await sendTextMessage(toSendablePhone(phone), aiResponse);
}

// ─── BAJA Handler ─────────────────────────────────────────────────────────────

async function handleBaja(
  phone: string,
  e164Phone: string,
  patientId: string
): Promise<void> {
  await prisma.patient.update({
    where: { id: patientId },
    // Trazabilidad: registra cuándo y por qué vía el paciente revocó el consentimiento.
    data: { consent: false, consentAt: new Date(), consentVia: ConsentVia.BOT },
  });

  const message =
    'Tu solicitud de baja fue procesada. No recibirás más recordatorios del IPS. ' +
    `Si querés volver a activarlos, escribí "ALTA" o comuníquese al ${config.IPS_SUPPORT_PHONE}.`;

  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, 'BAJA', message);
  await sendTextMessage(toSendablePhone(phone), message);
}

// ─── ALTA Handler ─────────────────────────────────────────────────────────────

async function handleAlta(
  phone: string,
  e164Phone: string,
  patientId: string
): Promise<void> {
  await prisma.patient.update({
    where: { id: patientId },
    // Trazabilidad: registra la reactivación del consentimiento vía bot.
    data: { consent: true, consentAt: new Date(), consentVia: ConsentVia.BOT },
  });

  const message =
    'Tus recordatorios fueron reactivados. Vas a recibir avisos de tus controles médicos. ' +
    'Si necesitás ayuda, escribime.';

  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, 'ALTA', message);
  await sendTextMessage(toSendablePhone(phone), message);
}

// ─── Escalation Handler ──────────────────────────────────────────────────────

async function handleEscalation(
  phone: string,
  e164Phone: string,
  patientId: string,
  text: string
): Promise<void> {
  const conversation = await getOrCreateConversation(e164Phone, patientId);

  // Mark conversation as ESCALATED
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: ConversationStatus.ESCALATED },
  });

  const message =
    'Entendido, voy a derivar tu consulta a un operador del IPS. ' +
    'Te van a responder por este mismo chat. ' +
    `Si es urgente, también podés llamar al ${config.IPS_SUPPORT_PHONE}.`;

  await saveMessagePair(conversation.id, text, message);
  await sendTextMessage(toSendablePhone(phone), message);
}

// ─── Access control helper (audit IDOR fix) ──────────────────────────────────
// Antes: cualquier DOCTOR autenticado podia responder/cerrar conversaciones de
// pacientes de OTROS programas. Ahora se verifica que el doctor pertenezca a
// al menos uno de los programas del paciente vinculado a la conversacion.

async function verifyConversationAccess(
  conversationId: string,
  doctorId: string,
  role: Role
): Promise<{ id: string; phone: string; status: ConversationStatus; patientId: string | null }> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      phone: true,
      status: true,
      patientId: true,
      patient: {
        select: {
          programs: {
            select: { programId: true },
          },
        },
      },
    },
  });

  if (!conversation) {
    throw new NotFoundError('Conversación no encontrada');
  }

  // ADMIN ve todo, no requiere chequeo de programas
  if (role === Role.ADMIN) {
    return {
      id: conversation.id,
      phone: conversation.phone,
      status: conversation.status,
      patientId: conversation.patientId,
    };
  }

  // DOCTOR debe tener acceso via doctor_programs ↔ patient_programs
  if (!conversation.patient) {
    // Conversación sin paciente vinculado — solo ADMIN.
    throw new NotFoundError('Conversación no encontrada');
  }

  const doctorPrograms = await prisma.doctorProgram.findMany({
    where: { doctorId },
    select: { programId: true },
  });
  const doctorProgramIds = new Set(doctorPrograms.map((dp) => dp.programId));
  const hasAccess = conversation.patient.programs.some((p) =>
    doctorProgramIds.has(p.programId)
  );

  if (!hasAccess) {
    // Mismo mensaje que "no encontrada" para no filtrar la existencia.
    throw new NotFoundError('Conversación no encontrada');
  }

  return {
    id: conversation.id,
    phone: conversation.phone,
    status: conversation.status,
    patientId: conversation.patientId,
  };
}

// ─── Reply from Panel (operator) ─────────────────────────────────────────────

export async function sendOperatorReply(
  conversationId: string,
  replyText: string,
  doctorId: string,
  role: Role
): Promise<void> {
  const conversation = await verifyConversationAccess(conversationId, doctorId, role);

  if (conversation.status !== ConversationStatus.ESCALATED) {
    throw new ValidationError('Solo se puede responder a conversaciones escaladas');
  }

  // Save message as SYSTEM (from operator) and send via WhatsApp
  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.SYSTEM,
      content: `[Operador] ${replyText}`,
    },
  });

  // sendTextMessage already normalizes internally via normalizePhoneForSend
  await sendTextMessage(conversation.phone, replyText);
}

// ─── Close escalated conversation ────────────────────────────────────────────

export async function closeEscalatedConversation(
  conversationId: string,
  doctorId: string,
  role: Role
): Promise<void> {
  const conversation = await verifyConversationAccess(conversationId, doctorId, role);

  if (conversation.status !== ConversationStatus.ESCALATED) {
    throw new ValidationError('Solo se puede cerrar conversaciones escaladas');
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
  });
}

// ─── Conversation & Message Persistence ───────────────────────────────────────

async function getOrCreateConversation(
  e164Phone: string,
  patientId: string | null
) {
  // Find existing open conversation
  const existing = await prisma.conversation.findFirst({
    where: {
      phone: e164Phone,
      status: ConversationStatus.OPEN,
    },
    select: { id: true },
  });

  if (existing) return existing;

  // Create new conversation
  return prisma.conversation.create({
    data: {
      phone: e164Phone,
      patientId,
      status: ConversationStatus.OPEN,
    },
    select: { id: true },
  });
}

async function linkConversationToPatient(e164Phone: string, patientId: string): Promise<void> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      phone: e164Phone,
      status: ConversationStatus.OPEN,
      patientId: null,
    },
  });

  if (conversation) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { patientId },
    });
  }
}

async function getConversationHistory(conversationId: string): Promise<ChatMessage[]> {
  // Fetch most recent N messages (desc), then reverse to chronological order
  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      role: { in: [MessageRole.USER, MessageRole.ASSISTANT] },
    },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_FOR_DB,
    select: {
      role: true,
      content: true,
    },
  });

  return messages.reverse().map((m) => ({
    role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }));
}

async function saveMessagePair(
  conversationId: string,
  userText: string,
  assistantText: string
): Promise<void> {
  await prisma.message.createMany({
    data: [
      {
        conversationId,
        role: MessageRole.USER,
        content: userText,
      },
      {
        conversationId,
        role: MessageRole.ASSISTANT,
        content: assistantText,
      },
    ],
  });
}

async function saveSystemMessage(
  e164Phone: string,
  patientId: string | null,
  userText: string,
  systemText: string
): Promise<void> {
  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await prisma.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        role: MessageRole.USER,
        content: userText,
      },
      {
        conversationId: conversation.id,
        role: MessageRole.SYSTEM,
        content: systemText,
      },
    ],
  });
}

async function saveMessages(
  e164Phone: string,
  patientId: string | null,
  userText: string,
  replyText: string
): Promise<void> {
  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, userText, replyText);
}

async function saveMessageAndReply(
  phone: string,
  e164Phone: string,
  patientId: string,
  userText: string,
  replyText: string
): Promise<void> {
  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, userText, replyText);
  await sendTextMessage(toSendablePhone(phone), replyText);
}
