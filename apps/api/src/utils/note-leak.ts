/**
 * Defensa server-side contra filtración de NOTAS OPERATIVAS INTERNAS al paciente
 * (regla no-negociable: el bot NUNCA debe revelar notas — ver CLAUDE.md, audit #5).
 *
 * Es defensa en profundidad: el prompt ya instruye no compartirlas, pero un modelo
 * puede equivocarse. Acá detectamos solapamiento textual y, si lo hay, reemplazamos
 * la respuesta. No es infalible (un parafraseo total se escapa), pero resiste trucos
 * triviales: distinto casing, acentos, puntuación, espaciado y palabras conectoras
 * intercaladas (compara secuencias de palabras significativas en AMBOS lados).
 */

/** Normaliza: minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizeForLeakCheck(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca acentos (diabético → diabetico)
    .replace(/[^a-z0-9\s]/g, ' ') // saca puntuación/símbolos
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palabras "significativas" (>4 chars) tras normalizar — descarta conectoras. */
function significantWords(s: string): string[] {
  return normalizeForLeakCheck(s)
    .split(' ')
    .filter((w) => w.length > 4);
}

/**
 * True si la respuesta del bot solapa contenido de alguna nota. Reduce nota y
 * respuesta a su secuencia de palabras significativas y busca una ventana de 3
 * (o todas, si la nota tiene menos de 3) como subsecuencia contigua. Así una nota
 * "diabético, no adherente al tratamiento" matchea "es diabetico y no adherente
 * con el tratamiento" pese a las palabras intercaladas.
 */
export function responseLeaksNotes(response: string, noteContents: string[]): boolean {
  const respSeq = significantWords(response).join(' ');
  if (!respSeq) return false;
  const haystack = ` ${respSeq} `;

  for (const note of noteContents) {
    const words = significantWords(note);
    if (words.length === 0) continue;

    const windowSize = Math.min(3, words.length);
    for (let i = 0; i <= words.length - windowSize; i++) {
      const fragment = words.slice(i, i + windowSize).join(' ');
      if (haystack.includes(` ${fragment} `)) return true;
    }
  }
  return false;
}
