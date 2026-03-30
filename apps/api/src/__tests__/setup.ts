// ─── Env vars MUST be set before any app code is imported ────────────────────
// vitest's setupFiles run before each test file, but module-level mocks (vi.mock)
// are hoisted above imports. We set env here so config/env.ts validation passes.

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!';
process.env.PORT = '3099';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
