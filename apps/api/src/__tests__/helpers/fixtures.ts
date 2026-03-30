import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Use cost 4 for fast hashing in fixtures
export const TEST_PASSWORD = 'Test1234!';
export const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);

export const TEST_JWT_SECRET = 'test-secret-at-least-32-characters-long!';

export const testDoctor = {
  id: 'doctor-uuid-1234',
  fullName: 'Dr. Maria Garcia',
  email: 'maria.garcia@ips.com',
  role: 'DOCTOR' as const,
  passwordHash: TEST_PASSWORD_HASH,
};

export const testAdminDoctor = {
  id: 'admin-uuid-5678',
  fullName: 'Dr. Admin User',
  email: 'admin@ips.com',
  role: 'ADMIN' as const,
  passwordHash: TEST_PASSWORD_HASH,
};

// Pre-generated tokens for integration tests
function makeAccessToken(overrides?: Record<string, unknown>): string {
  return jwt.sign(
    {
      sub: testDoctor.id,
      email: testDoctor.email,
      role: testDoctor.role,
      type: 'access',
      ...overrides,
    },
    TEST_JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function makeRefreshToken(overrides?: Record<string, unknown>): string {
  return jwt.sign(
    {
      sub: testDoctor.id,
      email: testDoctor.email,
      role: testDoctor.role,
      type: 'refresh',
      ...overrides,
    },
    TEST_JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function validAccessToken(): string {
  return makeAccessToken();
}

export function validRefreshToken(): string {
  return makeRefreshToken();
}

export function expiredAccessToken(): string {
  return jwt.sign(
    {
      sub: testDoctor.id,
      email: testDoctor.email,
      role: testDoctor.role,
      type: 'access',
    },
    TEST_JWT_SECRET,
    { expiresIn: -1 }
  );
}

export function expiredRefreshToken(): string {
  return jwt.sign(
    {
      sub: testDoctor.id,
      email: testDoctor.email,
      role: testDoctor.role,
      type: 'refresh',
    },
    TEST_JWT_SECRET,
    { expiresIn: -1 }
  );
}
