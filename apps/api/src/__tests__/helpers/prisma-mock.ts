import { vi } from 'vitest';

// Typed mock for the doctor model methods used in the codebase
export const mockPrisma = {
  doctor: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findMany: vi.fn(),
  },
};
