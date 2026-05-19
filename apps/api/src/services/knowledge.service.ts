import { prisma } from '@ips/db';
import { NotFoundError, ValidationError } from '../utils/errors';

// ─── KB cache in-memory (audit perf #2) ──────────────────────────────────────
// La KB tiene ~30 entradas y cambia poco (admin la edita rara vez). Cachearla
// 5 minutos elimina 1 query DB en cada mensaje del bot (hot path).

type CachedKBEntry = { category: string; question: string; answer: string };
const KB_CACHE_TTL_MS = 5 * 60 * 1000;
let kbCache: { entries: CachedKBEntry[]; expiresAt: number } | null = null;

async function getAllActiveKBCached(): Promise<CachedKBEntry[]> {
  if (kbCache && Date.now() < kbCache.expiresAt) {
    return kbCache.entries;
  }
  const entries = await prisma.knowledgeBase.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: { category: true, question: true, answer: true },
  });
  kbCache = { entries, expiresAt: Date.now() + KB_CACHE_TTL_MS };
  return entries;
}

/** Called from CRUD endpoints to force cache refresh after admin changes. */
export function invalidateKBCache(): void {
  kbCache = null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateKBInput {
  category: string;
  question: string;
  answer: string;
  sortOrder?: number;
}

export interface UpdateKBInput {
  category?: string;
  question?: string;
  answer?: string;
  sortOrder?: number;
  active?: boolean;
}

// ─── LIST (public for bot + panel) ──────────────────────────────────────────

export async function listKnowledge(filters: {
  category?: string;
  search?: string;
  activeOnly?: boolean;
  page?: number;
  limit?: number;
}) {
  const { category, search, activeOnly = true, page = 1, limit = 50 } = filters;

  const where = {
    ...(activeOnly ? { active: true } : {}),
    ...(category ? { category } : {}),
    ...(search
      ? {
          OR: [
            { question: { contains: search, mode: 'insensitive' as const } },
            { answer: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.knowledgeBase.findMany({
      where,
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        category: true,
        question: true,
        answer: true,
        sortOrder: true,
        active: true,
      },
    }),
    prisma.knowledgeBase.count({ where }),
  ]);

  return {
    items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

// ─── GET CATEGORIES ─────────────────────────────────────────────────────────

export async function getCategories() {
  const results = await prisma.knowledgeBase.findMany({
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });
  return results.map((r) => r.category);
}

// ─── CREATE (admin only) ────────────────────────────────────────────────────

export async function createKBEntry(input: CreateKBInput) {
  if (input.question.trim().length === 0) {
    throw new ValidationError('La pregunta es requerida');
  }
  if (input.answer.trim().length === 0) {
    throw new ValidationError('La respuesta es requerida');
  }

  const created = await prisma.knowledgeBase.create({
    data: {
      category: input.category.trim(),
      question: input.question.trim(),
      answer: input.answer.trim(),
      sortOrder: input.sortOrder ?? 0,
    },
    select: {
      id: true,
      category: true,
      question: true,
      answer: true,
      sortOrder: true,
      active: true,
    },
  });
  invalidateKBCache();
  return created;
}

// ─── UPDATE (admin only) ────────────────────────────────────────────────────

export async function updateKBEntry(id: string, input: UpdateKBInput) {
  const existing = await prisma.knowledgeBase.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new NotFoundError('Entrada no encontrada');
  }

  const updated = await prisma.knowledgeBase.update({
    where: { id },
    data: {
      ...(input.category !== undefined ? { category: input.category.trim() } : {}),
      ...(input.question !== undefined ? { question: input.question.trim() } : {}),
      ...(input.answer !== undefined ? { answer: input.answer.trim() } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
    select: {
      id: true,
      category: true,
      question: true,
      answer: true,
      sortOrder: true,
      active: true,
    },
  });
  invalidateKBCache();
  return updated;
}

// ─── DELETE (admin only) ─────────────────────────────────────────────────────

export async function deleteKBEntry(id: string) {
  const existing = await prisma.knowledgeBase.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!existing) {
    throw new NotFoundError('Entrada no encontrada');
  }

  await prisma.knowledgeBase.delete({ where: { id } });
  invalidateKBCache();
}

// ─── GET RELEVANT FOR BOT ──────────────────────────────────────────────────

/**
 * @internal Bot context only.
 * Fetches KB entries relevant to the user's message for the AI system prompt.
 * Uses keyword matching to find relevant FAQs.
 */
const BOT_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'con', 'por', 'para', 'sin',
  'que', 'es', 'son', 'fue', 'ser', 'hay', 'mas', 'pero',
  'como', 'este', 'esta', 'ese', 'esa', 'esto', 'eso',
  'yo', 'tu', 'nos', 'les', 'me', 'te', 'se', 'lo',
  'si', 'no', 'ya', 'muy', 'bien', 'mal', 'hola', 'buen',
  'quiero', 'tengo', 'puede', 'puedo', 'saber', 'decir',
  'sobre', 'donde', 'cuando', 'cual', 'tiene', 'hacer',
  'gracias', 'buenas', 'buena', 'tardes', 'noches', 'dias',
  'necesito', 'quisiera', 'ayuda', 'pregunta', 'duda',
  'favor', 'informacion', 'queria', 'consulta',
]);

export async function getRelevantKBForBot(userMessage: string, maxEntries = 5) {
  const safeMax = Math.min(maxEntries, 20);

  // Extract meaningful words filtering by stopwords instead of length
  const words = userMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, '')    // strip punctuation so "ips?" becomes "ips"
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !BOT_STOPWORDS.has(w))
    .slice(0, 6);

  // Cache hit es lo común — 1 query DB cada 5 min en vez de 1 por mensaje del bot.
  const all = await getAllActiveKBCached();

  if (words.length > 0) {
    const matched = all.filter((entry) => {
      const haystack = `${entry.question} ${entry.answer}`.toLowerCase();
      return words.some((w) => haystack.includes(w));
    });
    console.log('[KB] Keyword match found:', matched.length, 'entries (from cache,', all.length, 'total)');
    if (matched.length > 0) {
      return matched.slice(0, safeMax);
    }
  }

  // Decisión consciente (prompt-engineer audit): si no hay match, NO devolver
  // top entries arbitrarias — contamina el prompt con FAQs irrelevantes que
  // inducen respuestas off-topic. Mejor que el bot diga "no tengo esa info"
  // a que invente desde una FAQ random.
  console.warn('[KB] No keyword match for:', words, '— returning empty');
  return [];
}
