'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiGet, apiPost, getAccessToken } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Users,
  Filter,
  Plus,
  Download,
} from 'lucide-react';

interface Patient {
  id: string;
  fullName: string;
  dni: string;
  phone: string | null;
  consent: boolean;
  createdAt: string;
  activeProgramsCount: number;
}

interface PatientsResponse {
  patients: Patient[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface Program {
  id: string;
  name: string;
}

export default function PacientesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<PatientsResponse | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [programId, setProgramId] = useState(searchParams.get('programId') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [showCreate, setShowCreate] = useState(false);
  const [newPatient, setNewPatient] = useState({ fullName: '', dni: '', phone: '' });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Debounce search input (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (programId) params.set('programId', programId);
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('limit', '20');

    try {
      const result = await apiGet<PatientsResponse>(`/api/patients?${params}`);
      setData(result);
    } catch {
      // Error handled silently
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, programId, status, page]);

  useEffect(() => {
    apiGet<{ programs: Program[] }>('/api/programs').then((r) => setPrograms(r.programs)).catch(() => {});
  }, []);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (programId) params.set('programId', programId);
    if (status) params.set('status', status);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    router.replace(`/pacientes${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [debouncedSearch, programId, status, page, router]);

  async function handleCreatePatient(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setCreateLoading(true);
    try {
      const body: Record<string, string> = {
        fullName: newPatient.fullName.trim(),
        dni: newPatient.dni.trim().replace(/\./g, ''),
      };
      if (newPatient.phone.trim()) {
        const phone = newPatient.phone.trim();
        body.phone = phone.startsWith('+') ? phone : `+${phone}`;
      }
      await apiPost('/api/patients', body);
      setShowCreate(false);
      setNewPatient({ fullName: '', dni: '', phone: '' });
      fetchPatients();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Error al crear paciente');
    } finally {
      setCreateLoading(false);
    }
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Create patient dialog */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form onSubmit={handleCreatePatient} className="bg-white rounded-lg border border-border p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Crear paciente</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Nombre completo *</label>
                <input
                  type="text"
                  value={newPatient.fullName}
                  onChange={(e) => setNewPatient({ ...newPatient, fullName: e.target.value })}
                  required
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="María García"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">DNI *</label>
                <input
                  type="text"
                  value={newPatient.dni}
                  onChange={(e) => setNewPatient({ ...newPatient, dni: e.target.value })}
                  required
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="28456789"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Teléfono (WhatsApp, opcional)</label>
                <input
                  type="text"
                  value={newPatient.phone}
                  onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  placeholder="+5493764125878"
                />
              </div>
              {createError && <p className="text-xs text-destructive">{createError}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => { setShowCreate(false); setCreateError(''); }}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={createLoading}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {createLoading ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Users className="w-5 h-5" />
          Pacientes
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {data ? `${data.pagination.total} pacientes` : ''}
          </span>
          <button
            onClick={async () => {
              const params = [programId && `programId=${programId}`, status && `status=${status}`].filter(Boolean).join('&');
              const url = `/api/patients/export${params ? `?${params}` : ''}`;
              try {
                const res = await fetch(url, {
                  headers: { Authorization: `Bearer ${getAccessToken()}` },
                  credentials: 'include',
                });
                if (!res.ok) throw new Error('Error al exportar');
                const blob = await res.blob();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'pacientes.csv';
                a.click();
                URL.revokeObjectURL(a.href);
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Error al exportar');
              }
            }}
            className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Exportar CSV
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Crear paciente
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-border p-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre o DNI..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            />
          </div>

          {/* Program filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={programId}
              onChange={(e) => { setProgramId(e.target.value); setPage(1); }}
              className="h-9 pl-8 pr-8 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            >
              <option value="">Todos los programas</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          >
            <option value="">Todos los estados</option>
            <option value="ACTIVE">Activo</option>
            <option value="PAUSED">Pausado</option>
            <option value="COMPLETED">Completado</option>
          </select>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-slate-50/50">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Nombre</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">DNI</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Teléfono</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Prog. activos</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Registro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : data && data.patients.length > 0 ? (
                data.patients.map((patient) => (
                  <tr
                    key={patient.id}
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/pacientes/${patient.id}`)}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/pacientes/${patient.id}`}
                        className="text-sm font-medium text-foreground hover:text-primary"
                      >
                        {patient.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {patient.dni}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {patient.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {patient.activeProgramsCount > 0 ? (
                        <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                          {patient.activeProgramsCount}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {formatDate(patient.createdAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No se encontraron pacientes
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Página {data.pagination.page} de {data.pagination.pages}
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Página anterior"
                className="p-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
                disabled={page >= data.pagination.pages}
                aria-label="Página siguiente"
                className="p-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
