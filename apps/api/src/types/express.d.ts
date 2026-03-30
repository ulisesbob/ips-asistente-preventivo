import { Role } from '@ips/db';

declare global {
  namespace Express {
    interface Request {
      doctor?: {
        id: string;
        email: string;
        role: Role;
        fullName: string;
      };
    }
  }
}

export {};
