'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate } from '@/lib/utils';
import {
  Stethoscope,
  Plus,
  X,
  Pencil,
  BookOpen,
  Loader2,
  ShieldAlert,
} from 'lucide-react';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface DoctorProgram {
  id: string;
  assignedAt: string;
  program: { id: string; name: string };
}

interface Doctor {
  id: string;
  fullName: string;
  email: string;
  role: 'ADMIN' | 'DOCTOR';
  createdAt: string;
  programs: DoctorProgram[];
}

interface Program {
  id: string;
  name: string;
}

// ── Dialog wrapper ────────────────────────────────────────────────────────────

function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="relative bg-white rounded-lg border border-border shadow-lg w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MedicosPage() {
  const { doctor: currentDoctor } = useAuth();

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [createOpen, setCreateOpen] = useState(false);
  const [editDoctor, setEditDoctor] = useState<Doctor | null>(null);
  const [programsDoctor, setProgramsDoctor] = useState<Doctor | null>(null);

  // ── Fetch doctors ─────────────────────────────────────────────────────────

  const fetchDoctors = useCallback(async () => {
    try {
      const res = await apiGet<{ doctors: Doctor[] }>('/api/doctors');
      setDoctors(res.doctors);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  // Fetch programs once (for assign dialog)
  useEffect(() => {
    apiGet<{ programs: Program[] }>('/api/programs')
      .then((r) => setPrograms(r.programs))
      .catch(() => {});
  }, []);

  // ── Guard: only ADMIN ─────────────────────────────────────────────────────

  if (!currentDoctor) return null;
  if (currentDoctor.role !== 'ADMIN') {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert className="w-10 h-10 text-muted-foreground mb-3" />
        <h1 className="text-lg font-semibold text-foreground mb-1">No autorizado</h1>
        <p className="text-sm text-muted-foreground">
          Solo los administradores pueden acceder a esta sección.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Stethoscope className="w-5 h-5" />
          Médicos
        </h1>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Nuevo médico
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-slate-50/50">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Nombre
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Email
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Rol
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Programas
                </th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">
                  Fecha de creación
                </th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : doctors.length > 0 ? (
                doctors.map((doc) => (
                  <tr
                    key={doc.id}
                    className="hover:bg-slate-50/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {doc.fullName}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {doc.email}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={doc.role} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {doc.programs.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            Sin programas
                          </span>
                        ) : (
                          doc.programs.map((dp) => (
                            <span
                              key={dp.program.id}
                              className="inline-flex text-xs px-2 py-0.5 rounded border bg-slate-100 text-slate-700 border-slate-200"
                            >
                              {dp.program.name}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {formatDate(doc.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditDoctor(doc)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                          title="Editar médico"
                          aria-label={`Editar ${doc.fullName}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setProgramsDoctor(doc)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                          title="Gestionar programas"
                          aria-label={`Gestionar programas de ${doc.fullName}`}
                        >
                          <BookOpen className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-sm text-muted-foreground"
                  >
                    No hay médicos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────────── */}

      <CreateDoctorDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          fetchDoctors();
        }}
      />

      <EditDoctorDialog
        doctor={editDoctor}
        currentDoctorId={currentDoctor?.id ?? ''}
        onClose={() => setEditDoctor(null)}
        onUpdated={() => {
          setEditDoctor(null);
          fetchDoctors();
        }}
      />

      <ManageProgramsDialog
        doctor={programsDoctor}
        allPrograms={programs}
        onClose={() => setProgramsDoctor(null)}
        onChanged={async () => {
          // Refresh the specific doctor's programs in-place
          await fetchDoctors();
        }}
      />
    </div>
  );
}

// ── Role badge ────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: 'ADMIN' | 'DOCTOR' }) {
  const styles =
    role === 'ADMIN'
      ? 'bg-purple-50 text-purple-700 border-purple-200'
      : 'bg-blue-50 text-blue-700 border-blue-200';

  return (
    <span
      className={`inline-flex text-xs px-2 py-0.5 rounded border ${styles}`}
    >
      {role === 'ADMIN' ? 'Administrador' : 'Médico'}
    </span>
  );
}

// ── Create Doctor Dialog ──────────────────────────────────────────────────────

function CreateDoctorDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'DOCTOR' | 'ADMIN'>('DOCTOR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset form on open
  useEffect(() => {
    if (open) {
      setFullName('');
      setEmail('');
      setPassword('');
      setRole('DOCTOR');
      setError('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiPost('/api/doctors', { fullName, email, password, role });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Error al crear el médico.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Nuevo médico">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Nombre completo
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            placeholder="Dr. Juan Pérez"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            placeholder="juan@clinica.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Contraseña
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            placeholder="Mínimo 8 caracteres"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Rol
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'DOCTOR' | 'ADMIN')}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          >
            <option value="DOCTOR">Médico</option>
            <option value="ADMIN">Administrador</option>
          </select>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Crear médico
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Edit Doctor Dialog ────────────────────────────────────────────────────────

function EditDoctorDialog({
  doctor,
  currentDoctorId,
  onClose,
  onUpdated,
}: {
  doctor: Doctor | null;
  currentDoctorId: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'DOCTOR' | 'ADMIN'>('DOCTOR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const isSelf = doctor?.id === currentDoctorId;

  // Populate form when doctor changes
  useEffect(() => {
    if (doctor) {
      setFullName(doctor.fullName);
      setEmail(doctor.email);
      setRole(doctor.role);
      setError('');
    }
  }, [doctor]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctor) return;
    setSubmitting(true);
    setError('');
    try {
      await apiPatch(`/api/doctors/${doctor.id}`, {
        fullName,
        email,
        ...(isSelf ? {} : { role }),
      });
      onUpdated();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Error al actualizar el médico.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={doctor !== null}
      onClose={onClose}
      title="Editar médico"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Nombre completo
          </label>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Email
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            Rol
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'DOCTOR' | 'ADMIN')}
            disabled={isSelf}
            className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="DOCTOR">Médico</option>
            <option value="ADMIN">Administrador</option>
          </select>
          {isSelf && (
            <p className="text-xs text-muted-foreground mt-1">
              No podés cambiar tu propio rol.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar cambios
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Manage Programs Dialog ────────────────────────────────────────────────────

function ManageProgramsDialog({
  doctor,
  allPrograms,
  onClose,
  onChanged,
}: {
  doctor: Doctor | null;
  allPrograms: Program[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [assignedPrograms, setAssignedPrograms] = useState<DoctorProgram[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Sync assigned programs when doctor changes
  useEffect(() => {
    if (doctor) {
      setAssignedPrograms(doctor.programs);
      setSelectedProgramId('');
      setError('');
    }
  }, [doctor]);

  // Programs not yet assigned
  const assignedIds = new Set(assignedPrograms.map((dp) => dp.program.id));
  const unassignedPrograms = allPrograms.filter((p) => !assignedIds.has(p.id));

  async function handleAssign() {
    if (!doctor || !selectedProgramId) return;
    setAssigning(true);
    setError('');
    try {
      const res = await apiPost<{ assignment: DoctorProgram }>(
        `/api/doctors/${doctor.id}/programs`,
        { programId: selectedProgramId },
      );
      setAssignedPrograms((prev) => [...prev, res.assignment]);
      setSelectedProgramId('');
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Error al asignar el programa.',
      );
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(programId: string) {
    if (!doctor) return;
    setRemovingId(programId);
    setError('');
    try {
      await apiDelete(`/api/doctors/${doctor.id}/programs/${programId}`);
      setAssignedPrograms((prev) =>
        prev.filter((dp) => dp.program.id !== programId),
      );
      await onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Error al desasignar el programa.',
      );
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Dialog
      open={doctor !== null}
      onClose={onClose}
      title={`Programas de ${doctor?.fullName ?? ''}`}
    >
      <div className="space-y-4">
        {/* Current programs */}
        <div>
          <p className="text-sm font-medium text-foreground mb-2">
            Programas asignados
          </p>
          {assignedPrograms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center bg-slate-50 rounded-md">
              Sin programas asignados
            </p>
          ) : (
            <div className="space-y-1.5">
              {assignedPrograms.map((dp) => (
                <div
                  key={dp.program.id}
                  className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2"
                >
                  <span className="text-sm text-foreground">
                    {dp.program.name}
                  </span>
                  <button
                    onClick={() => handleUnassign(dp.program.id)}
                    disabled={removingId === dp.program.id}
                    className="p-1 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 cursor-pointer"
                    title="Desasignar programa"
                    aria-label={`Desasignar ${dp.program.name}`}
                  >
                    {removingId === dp.program.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <X className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="border-t border-border" />

        {/* Add program */}
        <div>
          <p className="text-sm font-medium text-foreground mb-2">
            Agregar programa
          </p>
          {unassignedPrograms.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center bg-slate-50 rounded-md">
              Todos los programas ya están asignados
            </p>
          ) : (
            <div className="flex gap-2">
              <select
                value={selectedProgramId}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              >
                <option value="">Seleccionar programa...</option>
                {unassignedPrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAssign}
                disabled={!selectedProgramId || assigning}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {assigning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Asignar
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm text-foreground hover:bg-accent transition-colors cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </Dialog>
  );
}
