'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { apiGet, apiPost, setAccessToken } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Doctor {
  id: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'DOCTOR';
}

interface AuthContextValue {
  doctor: Doctor | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// ── Context ────────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Restore session on mount via /api/auth/me
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        const data = await apiGet<{ doctor: Doctor }>('/api/auth/me');
        if (!cancelled) {
          setDoctor(data.doctor);
        }
      } catch {
        // No valid session — stay logged out
        if (!cancelled) {
          setDoctor(null);
          setAccessToken(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await apiPost<{ accessToken: string; doctor: Doctor }>(
        '/api/auth/login',
        { email, password },
      );
      setAccessToken(data.accessToken);
      setDoctor(data.doctor);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost('/api/auth/logout');
    } catch {
      // Even if the API call fails, clear local state
    }
    setAccessToken(null);
    setDoctor(null);
    router.push('/login');
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({ doctor, isLoading, login, logout }),
    [doctor, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
