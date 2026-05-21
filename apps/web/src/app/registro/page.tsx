'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Activity, CheckCircle2 } from 'lucide-react';
import { apiPost, ApiError } from '@/lib/api';

type FieldErrors = Record<string, string[]>;

export default function RegistroPage() {
  const [fullName, setFullName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  function validate(): string | null {
    if (!fullName.trim()) return 'Ingresá tu nombre completo.';
    if (!licenseNumber.trim()) return 'Ingresá tu matrícula profesional.';
    if (!email.trim()) return 'Ingresá tu email institucional.';
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost<{ message: string }>('/api/auth/register', {
        fullName: fullName.trim(),
        licenseNumber: licenseNumber.trim(),
        email: email.trim(),
        password,
      });
      setSuccessMessage(data?.message ?? 'Cuenta creada. Revisá tu correo para verificar tu email.');
    } catch (err) {
      if (err instanceof ApiError) {
        // 400 de validación puede traer errors por campo en el body.
        const body = err.responseBody as
          | { errors?: FieldErrors }
          | undefined;
        if (body?.errors) {
          setFieldErrors(body.errors);
        }
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Error al registrarse');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-primary text-primary-foreground mb-4">
            <Activity className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
            IPS — Crear cuenta
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Asistente Preventivo para Pacientes Crónicos
          </p>
        </div>

        {successMessage ? (
          <div className="bg-white rounded-lg border border-border p-6 shadow-sm text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 text-green-600 mb-4">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm text-foreground mb-2">{successMessage}</p>
            <p className="text-sm text-muted-foreground">
              Revisá tu correo y hacé clic en el link para verificar tu email.
            </p>
            <p className="text-sm text-muted-foreground text-center mt-6">
              <Link href="/login" className="text-primary hover:underline">
                Volver a iniciar sesión
              </Link>
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg border border-border p-6 shadow-sm"
          >
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="fullName"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Nombre completo
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dra. María Pérez"
                  required
                  autoFocus
                  autoComplete="name"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
                {fieldErrors.fullName && (
                  <p className="text-xs text-destructive mt-1" role="alert">
                    {fieldErrors.fullName.join(' ')}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="licenseNumber"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Matrícula profesional
                </label>
                <input
                  id="licenseNumber"
                  type="text"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="MP 12345"
                  required
                  autoComplete="off"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
                {fieldErrors.licenseNumber && (
                  <p className="text-xs text-destructive mt-1" role="alert">
                    {fieldErrors.licenseNumber.join(' ')}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Email institucional
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="doctor@ips.gob.ar"
                  required
                  autoComplete="email"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Usá tu email institucional de IPS.
                </p>
                {fieldErrors.email && (
                  <p className="text-xs text-destructive mt-1" role="alert">
                    {fieldErrors.email.join(' ')}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-foreground mb-1.5"
                >
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="********"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Mínimo 8 caracteres.
                </p>
                {fieldErrors.password && (
                  <p className="text-xs text-destructive mt-1" role="alert">
                    {fieldErrors.password.join(' ')}
                  </p>
                )}
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? 'Creando cuenta...' : 'Crear cuenta'}
              </button>

              <p className="text-sm text-muted-foreground text-center">
                ¿Ya tenés cuenta?{' '}
                <Link href="/login" className="text-primary hover:underline">
                  Iniciá sesión
                </Link>
              </p>
            </div>
          </form>
        )}

        <p className="text-xs text-muted-foreground text-center mt-6">
          Instituto de Previsión Social de Misiones
        </p>
      </div>
    </div>
  );
}
