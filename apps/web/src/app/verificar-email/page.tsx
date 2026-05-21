'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { apiPost, ApiError } from '@/lib/api';

type Status = 'verifying' | 'success' | 'error';

function VerificarEmailInner() {
  const [status, setStatus] = useState<Status>('verifying');
  const [message, setMessage] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    // Corre UNA sola vez en el montaje. startedRef evita el doble disparo del
    // StrictMode (el token es de un solo uso). Clave: NO dependemos de
    // useSearchParams ni cancelamos el request — el replaceState de abajo cambia
    // la URL, y si el effect dependiera de searchParams se re-dispararía y
    // descartaría la respuesta, dejando la UI colgada en "verificando".
    if (startedRef.current) return;
    startedRef.current = true;

    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setStatus('error');
      setMessage('Link inválido: falta el token de verificación.');
      return;
    }

    // Sacamos el token de la URL: no queda en el historial / Referer / logs.
    window.history.replaceState(null, '', '/verificar-email');

    apiPost<{ message: string }>('/api/auth/verify-email', { token })
      .then((data) => {
        setStatus('success');
        setMessage(data?.message ?? '');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(
          err instanceof ApiError
            ? err.message
            : 'No pudimos verificar tu email. Probá de nuevo en un momento.',
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bg-white rounded-lg border border-border p-6 shadow-sm text-center">
      {status === 'verifying' && (
        <>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-muted-foreground mb-4">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <p className="text-sm text-foreground">Verificando tu email...</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <p className="text-sm text-foreground mb-1">
            ¡Email verificado! Ya podés iniciar sesión.
          </p>
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
          <Link
            href="/login"
            className="inline-flex items-center justify-center w-full h-10 mt-6 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
          >
            Iniciar sesión
          </Link>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-destructive mb-4">
            <XCircle className="w-6 h-6" />
          </div>
          <p className="text-sm text-foreground mb-1" role="alert">
            No pudimos verificar tu email.
          </p>
          {message && (
            <p className="text-sm text-muted-foreground">{message}</p>
          )}
          <p className="text-sm text-muted-foreground mt-6">
            <Link href="/registro" className="text-primary hover:underline">
              Volver a registrarte
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function VerificarEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary text-primary-foreground mb-4">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            IPS — Verificar email
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Asistente Preventivo para Pacientes Crónicos
          </p>
        </div>

        <Suspense
          fallback={
            <div className="bg-white rounded-lg border border-border p-6 shadow-sm text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-muted-foreground mb-4">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <p className="text-sm text-foreground">Cargando...</p>
            </div>
          }
        >
          <VerificarEmailInner />
        </Suspense>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Instituto de Previsión Social de Misiones
        </p>
      </div>
    </div>
  );
}
