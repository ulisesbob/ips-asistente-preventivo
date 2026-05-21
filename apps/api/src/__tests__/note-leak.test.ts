import { describe, it, expect } from 'vitest';
import { responseLeaksNotes, normalizeForLeakCheck } from '../utils/note-leak';

describe('note-leak defense (audit #5)', () => {
  const NOTE = 'Paciente diabético, no adherente al tratamiento. Faltó a 3 controles.';

  it('detecta reproducción casi literal de la nota', () => {
    expect(responseLeaksNotes('El paciente es diabetico no adherente al tratamiento', [NOTE])).toBe(true);
  });

  it('detecta fuga aunque cambien acentos y mayúsculas', () => {
    expect(responseLeaksNotes('DIABÉTICO NO ADHERENTE AL TRATAMIENTO', [NOTE])).toBe(true);
  });

  it('detecta fuga con puntuación/espaciado distinto', () => {
    expect(responseLeaksNotes('...diabetico,   no-adherente   al... tratamiento!', [NOTE])).toBe(true);
  });

  it('detecta fuga con palabras conectoras intercaladas', () => {
    expect(responseLeaksNotes('es diabetico y no es adherente con el tratamiento', [NOTE])).toBe(true);
  });

  it('NO marca una respuesta legítima sin solapamiento', () => {
    const ok = 'Tu próximo control es el 15 de junio. Recordá llevar tu carnet.';
    expect(responseLeaksNotes(ok, [NOTE])).toBe(false);
  });

  it('respuesta vacía o sin notas → false', () => {
    expect(responseLeaksNotes('', [NOTE])).toBe(false);
    expect(responseLeaksNotes('cualquier cosa', [])).toBe(false);
  });

  it('nota corta (< 3 palabras significativas) exige las palabras presentes', () => {
    expect(responseLeaksNotes('el paciente está descompensado hoy', ['descompensado'])).toBe(true);
    expect(responseLeaksNotes('todo bien con el control', ['descompensado'])).toBe(false);
  });

  it('normalizeForLeakCheck saca acentos, puntuación y colapsa espacios', () => {
    expect(normalizeForLeakCheck('  Diabético,   TIPO-2!! ')).toBe('diabetico tipo 2');
  });
});
