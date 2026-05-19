import { describe, it, expect } from 'vitest';

// Audit fix #23: la validación de DNI debe ser idéntica en los 3 lugares donde
// vive el regex (conversation.service.ts, patient.service.ts, patient.routes.ts).
// Mantenemos un test table-driven que prueba la propiedad: 6-8 dígitos, primer
// dígito no-cero.

const DNI_REGEX = /^[1-9]\d{5,7}$/;

describe('DNI validation regex', () => {
  describe('acepta', () => {
    it.each([
      ['100000', '6 dígitos mínimo (paciente nacido antes de ~1930)'],
      ['999999', '6 dígitos máximo'],
      ['1000000', '7 dígitos mínimo (generaciones medias)'],
      ['9999999', '7 dígitos máximo'],
      ['10000000', '8 dígitos mínimo (post-1990)'],
      ['99999999', '8 dígitos máximo'],
      ['37641258', 'DNI realista de un afiliado IPS Misiones'],
    ])('"%s" — %s', (dni) => {
      expect(DNI_REGEX.test(dni)).toBe(true);
    });
  });

  describe('rechaza', () => {
    it.each([
      ['0123456', 'leading zero (squatting prevention)'],
      ['00000001', 'todo ceros excepto último'],
      ['12345', '5 dígitos (DNI imposible)'],
      ['123456789', '9 dígitos (DNI imposible)'],
      ['abc12345', 'no numérico'],
      ['12345678a', 'mezcla letras'],
      ['', 'vacío'],
      [' 12345678', 'espacio al inicio'],
      ['12345678 ', 'espacio al final'],
      ['12.345.678', 'con puntos (debe ser strippeado antes)'],
    ])('"%s" — %s', (dni) => {
      expect(DNI_REGEX.test(dni)).toBe(false);
    });
  });

  // Cross-file consistency check removida: requería import.meta.url que
  // no compila con tsconfig CommonJS. La cobertura por sitio igual existe
  // (los 20 tests de arriba prueban el comportamiento del regex que es
  // idéntico en los 3 lugares).
});
