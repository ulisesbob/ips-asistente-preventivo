import {
  prisma,
  ConversationStatus,
  MessageRole,
  RegisteredVia,
  PatientProgramStatus,
} from '@ips/db';
import { sendTextMessage } from './whatsapp.service';
import { generateResponse, buildSystemPrompt, ChatMessage } from './ai.service';
import { getLatestNotesForBot } from './note.service';
import { getRelevantKBForBot } from './knowledge.service';
import { processSurveyResponse } from './survey.service';

// ─── Constants ────────────────────────────────────────────────────────────────

const DNI_REGEX = /^\d{7,8}$/;
const E164_PHONE_REGEX = /^\d{7,15}$/;
const REGISTRATION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_HISTORY_FOR_DB = 20; // Align with AI service MAX_HISTORY_MESSAGES

// Escalation keywords — patient wants to talk to a human
const ESCALATION_KEYWORDS = [
  'operador', 'operadora', 'hablar con alguien', 'persona real',
  'quiero hablar', 'agente', 'humano', 'atencion humana',
  'necesito ayuda', 'no me sirve', 'reclamar', 'reclamo', 'queja',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConversationState {
  step: 'AWAITING_NAME' | 'AWAITING_DNI';
  tempName?: string;
  createdAt: number;
}

// In-memory state for registration flows (keyed by phone).
// This is safe because registration is a short-lived flow (2-3 messages).
// If the server restarts mid-registration, the user just starts over.
const registrationState = new Map<string, ConversationState>();

// Periodic cleanup of stale registration entries
setInterval(() => {
  const now = Date.now();
  for (const [phone, state] of registrationState.entries()) {
    if (now - state.createdAt > REGISTRATION_TTL_MS) {
      registrationState.delete(phone);
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
  _displayName: string
): Promise<void> {
  // Normalize phone: ensure no + prefix (Meta sends without it)
  const normalizedPhone = phone.startsWith('+') ? phone.slice(1) : phone;

  // Validate phone format
  if (!E164_PHONE_REGEX.test(normalizedPhone)) {
    console.warn(`[WhatsApp] Número de teléfono inválido ignorado: ${phone}`);
    return;
  }

  // For DB storage, use E.164 with +
  const e164Phone = `+${normalizedPhone}`;

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

  // 4. Check for pending survey response
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
      select: { id: true },
    });

    if (activeConv) {
      // Save message but don't respond — human operator handles this from the panel
      await prisma.message.create({
        data: { conversationId: activeConv.id, role: MessageRole.USER, content: text },
      });
      return;
    }

    // 5. Check for escalation keywords
    const textLower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const wantsHuman = ESCALATION_KEYWORDS.some((kw) => textLower.includes(kw));

    if (wantsHuman) {
      await handleEscalation(normalizedPhone, e164Phone, patient.id, text);
      return;
    }

    // 6. Normal chat mode
    await handleChat(normalizedPhone, e164Phone, patient, text);
    return;
  }

  // 5. If patient found but WA not linked (imported via CSV/panel) → link and go to chat
  if (patient && !patient.whatsappLinked) {
    // Always link the phone, but respect consent before sending messages
    await prisma.patient.update({
      where: { id: patient.id },
      data: { whatsappLinked: true },
    });

    if (!patient.consent) {
      // Patient opted out — link silently, don't send messages
      return;
    }

    const greeting = patient.programs.length > 0
      ? `Hola ${patient.fullName}! Soy el asistente virtual del IPS. ` +
        `Estás inscripto/a en: ${patient.programs.map((pp) => pp.program.name).join(', ')}. ` +
        `¿En qué puedo ayudarte?`
      : `Hola ${patient.fullName}! Soy el asistente virtual del IPS. ` +
        `Ya estás registrado/a. ¿En qué puedo ayudarte?`;

    await saveMessageAndReply(normalizedPhone, e164Phone, patient.id, text, greeting);
    return;
  }

  // 6. Not found → registration flow
  await handleRegistration(normalizedPhone, e164Phone, text);
}

// ─── Registration Flow ────────────────────────────────────────────────────────

async function handleRegistration(
  phone: string,
  e164Phone: string,
  text: string
): Promise<void> {
  const state = getRegistrationState(phone);

  // Step 1: First message ever — ask for name
  // Set state AFTER send succeeds to avoid broken flow if send fails
  if (!state) {
    const greeting =
      'Hola! Soy el asistente virtual del IPS (Instituto de Previsión Social de Misiones). ' +
      'Para poder ayudarte, necesito algunos datos.\n\n' +
      '¿Cuál es tu nombre completo?';

    await saveSystemMessage(e164Phone, null, text, greeting);
    await sendTextMessage(phone, greeting);
    registrationState.set(phone, { step: 'AWAITING_NAME', createdAt: Date.now() });
    return;
  }

  // Step 2: Received name — ask for DNI
  if (state.step === 'AWAITING_NAME') {
    const name = text.trim();

    if (name.length < 2 || name.length > 200) {
      const retry = 'El nombre debe tener entre 2 y 200 caracteres. ¿Cuál es tu nombre completo?';
      await sendTextMessage(phone, retry);
      return;
    }

    registrationState.set(phone, { step: 'AWAITING_DNI', tempName: name, createdAt: state.createdAt });

    const askDni = `Gracias, ${name}. ¿Cuál es tu número de DNI? (sin puntos)`;
    await saveMessages(e164Phone, null, text, askDni);
    await sendTextMessage(phone, askDni);
    return;
  }

  // Step 3: Received DNI — UPSERT patient, link phone
  if (state.step === 'AWAITING_DNI') {
    const dni = text.trim().replace(/\./g, '');

    if (!DNI_REGEX.test(dni)) {
      const retry = 'El DNI debe tener 7 u 8 dígitos. Por favor, ingresá tu DNI nuevamente:';
      await sendTextMessage(phone, retry);
      return;
    }

    // UPSERT by DNI — core deduplication logic
    const existing = await prisma.patient.findUnique({
      where: { dni },
      select: {
        id: true,
        fullName: true,
        phone: true,
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
      // SECURITY: If the patient already has a DIFFERENT phone linked,
      // do NOT silently reassign — potential hijacking attempt.
      if (existing.phone && existing.phone !== e164Phone) {
        console.warn(
          `[Security] DNI ${dni} ya vinculado a teléfono diferente. ` +
          `Intento desde: ${e164Phone}. Vinculación rechazada.`
        );
        registrationState.delete(phone);
        const rejection =
          'Tu DNI ya está asociado a otro número de WhatsApp. ' +
          'Para modificar tu número, comuníquese al 0800-888-0109.';
        await sendTextMessage(phone, rejection);
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
        `Esta información es orientativa. Para consultas sobre su caso, comuníquese al 0800-888-0109.`;
    } else {
      welcome =
        `Listo, ${patientName}! Ya quedaste registrado/a en el sistema. ` +
        `Un médico completará tu información y podrá inscribirte en los programas que correspondan.\n\n` +
        `¿Tenés alguna consulta general?\n\n` +
        `Esta información es orientativa. Para consultas sobre su caso, comuníquese al 0800-888-0109.`;
    }

    await saveMessages(e164Phone, patientId, text, welcome);
    await sendTextMessage(phone, welcome);
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
  // Fetch context for AI: notes + relevant knowledge base
  const [notes, kbEntries] = await Promise.all([
    getLatestNotesForBot(patient.id),
    getRelevantKBForBot(text),
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
  });

  // Debug: log what the AI will see
  console.log(`[Bot] Patient ${patient.fullName} has ${patient.programs.length} active programs`);
  if (patient.programs.length > 0) {
    patient.programs.forEach((pp) => {
      console.log(`[Bot]   - ${pp.program.name}: next=${pp.nextReminderDate}, last=${pp.lastControlDate}`);
    });
  }

  // Get conversation history — limit to last 6 messages to avoid old prompt contamination
  const conversation = await getOrCreateConversation(e164Phone, patient.id);
  const history = await getConversationHistory(conversation.id);

  // Only use recent history (3 exchanges) to prevent old response patterns from dominating
  const recentHistory = history.slice(-6);

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
      'Para consultas, comuníquese al 0800-888-0109.';
  }

  // Server-side defense: check if AI leaked note content (C1 security fix)
  if (notes.length > 0) {
    const leaked = notes.some((n) => {
      const words = n.content.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      // Check if 3+ consecutive words from a note appear in the response
      const responseLower = aiResponse.toLowerCase();
      for (let i = 0; i <= words.length - 3; i++) {
        const fragment = words.slice(i, i + 3).join(' ');
        if (responseLower.includes(fragment)) return true;
      }
      return false;
    });
    if (leaked) {
      console.warn(`[Security] AI response may contain leaked note content for patient ${patient.id}. Replacing.`);
      aiResponse =
        'No tengo acceso a esa información. ' +
        '¿Hay algo más en lo que pueda ayudarte?\n\n' +
        'Esta información es orientativa. Para consultas sobre su caso, comuníquese al 0800-888-0109.';
    }
  }

  // Save both messages and send reply
  await saveMessagePair(conversation.id, text, aiResponse);
  await sendTextMessage(phone, aiResponse);
}

// ─── BAJA Handler ─────────────────────────────────────────────────────────────

async function handleBaja(
  phone: string,
  e164Phone: string,
  patientId: string
): Promise<void> {
  await prisma.patient.update({
    where: { id: patientId },
    data: { consent: false },
  });

  const message =
    'Tu solicitud de baja fue procesada. No recibirás más recordatorios del IPS. ' +
    'Si querés volver a activarlos, escribí "ALTA" o comuníquese al 0800-888-0109.';

  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, 'BAJA', message);
  await sendTextMessage(phone, message);
}

// ─── ALTA Handler ─────────────────────────────────────────────────────────────

async function handleAlta(
  phone: string,
  e164Phone: string,
  patientId: string
): Promise<void> {
  await prisma.patient.update({
    where: { id: patientId },
    data: { consent: true },
  });

  const message =
    'Tus recordatorios fueron reactivados. Vas a recibir avisos de tus controles médicos. ' +
    'Si necesitás ayuda, escribime.';

  const conversation = await getOrCreateConversation(e164Phone, patientId);
  await saveMessagePair(conversation.id, 'ALTA', message);
  await sendTextMessage(phone, message);
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
    'Si es urgente, también podés llamar al 0800-888-0109.';

  await saveMessagePair(conversation.id, text, message);
  await sendTextMessage(phone, message);
}

// ─── Reply from Panel (operator) ─────────────────────────────────────────────

export async function sendOperatorReply(
  conversationId: string,
  replyText: string,
  doctorId: string
): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, phone: true, status: true },
  });

  if (!conversation) {
    throw new Error('Conversación no encontrada');
  }

  // Normalize phone for sending (remove + prefix, apply Argentina fix LESSONS #40)
  let sendPhone = conversation.phone.startsWith('+')
    ? conversation.phone.slice(1)
    : conversation.phone;

  // Argentina: 549 → 54 (LESSONS #40)
  if (sendPhone.startsWith('549') && sendPhone.length === 13) {
    sendPhone = '54' + sendPhone.slice(3);
  }

  // Save message as SYSTEM (from operator) and send via WhatsApp
  await prisma.message.create({
    data: {
      conversationId,
      role: MessageRole.SYSTEM,
      content: `[Operador] ${replyText}`,
    },
  });

  await sendTextMessage(sendPhone, replyText);
}

// ─── Close escalated conversation ────────────────────────────────────────────

export async function closeEscalatedConversation(conversationId: string): Promise<void> {
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
  await sendTextMessage(phone, replyText);
}
