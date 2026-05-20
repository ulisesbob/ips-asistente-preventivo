// ─── Env vars MUST be set before any app code is imported ────────────────────
// vitest's setupFiles run before each test file, but module-level mocks (vi.mock)
// are hoisted above imports. We set env here so config/env.ts validation passes.

// Respeta una DATABASE_URL ya provista (tests de integración contra Postgres real);
// si no, usa un dummy (los tests unitarios mockean Prisma y no tocan la DB).
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!';
process.env.PORT = '3099';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
// Clave de cifrado de campos (prisma-field-encryption). Debe estar seteada antes
// de importar @ips/db, porque la extensión la lee al construir el cliente.
// Clave dedicada de test — NO es la de producción.
process.env.PRISMA_FIELD_ENCRYPTION_KEY =
  process.env.PRISMA_FIELD_ENCRYPTION_KEY ||
  'k1.aesgcm256.lEUt2MurZ4ysQVN5mZW3EckuX6oqTe2-fR4eWsfze2g=';
