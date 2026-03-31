'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/utils';
import {
  ArrowLeft,
  Phone,
  CreditCard,
  Calendar,
  CheckCircle2,
  Clock,
  Pause,
  Play,
  Bell,
  MessageSquare,
  Shield,
  ShieldOff,
  Plus,
  StickyNote,
  Send,
  CalendarDays,
} from 'lucide-react';

interface PatientDetail {
  id: string;
  fullName: string;
  dni: string;
  phone: string | null;
  birthDate: string | null;
  gender: string | null;
  consent: boolean;
  registeredVia: string;
  whatsappLinked: boolean;
  createdAt: string;
  programs: PatientProgram[];
  reminders: Reminder[];
  conversations: Conversation[];
}

interface PatientProgram {
  id: string;
  enrolledAt: string;
  lastControlDate: string | null;
  nextReminderDate: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  program: { id: string; name: string; reminderFrequencyDays: number };
  enrolledByDoctor: { fullName: string };
}

interface Reminder {
  id: string;
  scheduledFor: string;
  sentAt: string | null;
  status: string;
  patientReplied: boolean;
  program: { name: string };
}

interface Conversation {
  id: string;
  status: string;
  startedAt: string;
  closedAt: string | null;
  _count: { messages: number };
}

interface PatientNoteItem {
  id: string;
  content: string;
  createdAt: string;
  doctor: { id: string; fullName: string };
}

const STATUS_CONFIG = {
  ACTIVE: { label: 'Activo', icon: Play, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  PAUSED: { label: 'Pausado', icon: Pause, className: 'bg-amber-50 text-amber-700 border-amber-200' },
  COMPLETED: { label: 'Completado', icon: CheckCircle2, className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const REMINDER_STATUS = {
  SENT: { label: 'Enviado', className: 'text-emerald-600' },
  FAILED: { label: 'Fallido', className: 'text-red-600' },
  PENDING: { label: 'Pendiente', className: 'text-amber-600' },
};

export default function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { doctor } = useAuth();
  const [patient, setPatient] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [editDatePpId, setEditDatePpId] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState('');
  const [editDateLoading, setEditDateLoading] = useState(false);
  const [notes, setNotes] = useState<PatientNoteItem[]>([]);
  const [notesPage, setNotesPage] = useState(1);
  const [notesTotal, setNotesTotal] = useState(0);
  const [notesPages, setNotesPages] = useState(0);
  const [noteContent, setNoteContent] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);

  const fetchPatient = useCallback(async () => {
    try {
      const result = await apiGet<{ patient: PatientDetail }>(`/api/patients/${id}`);
      setPatient(result.patient);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, [id]);

  const [notesError, setNotesError] = useState<string | null>(null);

  const fetchNotes = useCallback(async (page = 1) => {
    if (notesLoading) return;
    setNotesLoading(true);
    try {
      setNotesError(null);
      const result = await apiGet<{
        notes: PatientNoteItem[];
        pagination: { page: number; total: number; pages: number };
      }>(`/api/patients/${id}/notes?page=${page}&limit=10`);
      if (page === 1) {
        setNotes(result.notes);
      } else {
        setNotes((prev) => [...prev, ...result.notes]);
      }
      setNotesPage(result.pagination.page);
      setNotesTotal(result.pagination.total);
      setNotesPages(result.pagination.pages);
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : 'Error al cargar notas');
    } finally {
      setNotesLoading(false);
    }
  }, [id, notesLoading]);

  async function handleSubmitNote() {
    const trimmed = noteContent.trim();
    if (!trimmed || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await apiPost(`/api/patients/${id}/notes`, { content: trimmed });
      setNoteContent('');
      await fetchNotes(1);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al crear nota');
    } finally {
      setNoteSubmitting(false);
    }
  }

  useEffect(() => {
    fetchPatient();
    fetchNotes(1);
  }, [fetchPatient, fetchNotes]);

  async function openEnrollDialog() {
    try {
      const data = await apiGet<{ programs: { id: string; name: string }[] }>('/api/programs');
      const enrolledIds = new Set(patient?.programs.map((pp) => pp.program.id) ?? []);
      const available = data.programs.filter((p) => !enrolledIds.has(p.id));
      setPrograms(available);
      setSelectedProgramId(available[0]?.id ?? '');
      setShowEnroll(true);
    } catch {
      alert('Error al cargar programas');
    }
  }

  async function handleEnroll() {
    if (!selectedProgramId) return;
    setEnrollLoading(true);
    try {
      await apiPost(`/api/patients/${id}/programs`, { programId: selectedProgramId });
      setShowEnroll(false);
      await fetchPatient();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al inscribir');
    } finally {
      setEnrollLoading(false);
    }
  }

  async function handleMarkControl(ppId: string) {
    setActionLoading(ppId);
    try {
      await apiPost(`/api/patient-programs/${ppId}/control`, {});
      await fetchPatient();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al marcar control');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleStatus(ppId: string, currentStatus: string) {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setActionLoading(`status-${ppId}`);
    try {
      await apiPatch(`/api/patient-programs/${ppId}`, { status: newStatus });
      await fetchPatient();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al cambiar estado');
    } finally {
      setActionLoading(null);
    }
  }

  function openEditDate(ppId: string, currentDate: string) {
    // currentDate is ISO string like "2026-04-15T00:00:00.000Z" — extract YYYY-MM-DD
    setEditDateValue(currentDate.slice(0, 10));
    setEditDatePpId(ppId);
  }

  async function handleUpdateNextControl() {
    if (!editDatePpId || !editDateValue) return;
    setEditDateLoading(true);
    try {
      await apiPatch(`/api/patient-programs/${editDatePpId}/next-control`, {
        nextControlDate: editDateValue,
      });
      setEditDatePpId(null);
      await fetchPatient();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al cambiar fecha');
    } finally {
      setEditDateLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-32 bg-slate-100 rounded animate-pulse" />
        <div className="h-40 bg-white rounded-lg border border-border animate-pulse" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <p className="text-sm text-muted-foreground">Paciente no encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push('/pacientes')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Pacientes
        </button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">{patient.fullName}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> {patient.dni}</span>
              {patient.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> {patient.phone}</span>}
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Desde {formatDate(patient.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {patient.consent ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                <Shield className="w-3 h-3" /> Consentimiento activo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-red-50 text-red-700 border-red-200">
                <ShieldOff className="w-3 h-3" /> Sin consentimiento
              </span>
            )}
            {patient.whatsappLinked && (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                <MessageSquare className="w-3 h-3" /> WhatsApp vinculado
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Personal info */}
      <div className="bg-white rounded-lg border border-border p-5">
        <h2 className="text-sm font-medium text-foreground mb-3">Datos personales</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Fecha de nacimiento</span>
            <p className="font-medium">{patient.birthDate ? formatDate(patient.birthDate) : '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Género</span>
            <p className="font-medium">{patient.gender === 'M' ? 'Masculino' : patient.gender === 'F' ? 'Femenino' : patient.gender || '—'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Registrado vía</span>
            <p className="font-medium">{patient.registeredVia}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Teléfono</span>
            <p className="font-medium">{patient.phone || 'No registrado'}</p>
          </div>
        </div>
      </div>

      {/* Enroll dialog */}
      {showEnroll && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-border p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Inscribir en programa</h3>
            {programs.length === 0 ? (
              <p className="text-sm text-muted-foreground mb-4">Ya está inscripto en todos los programas.</p>
            ) : (
              <select
                value={selectedProgramId}
                onChange={(e) => setSelectedProgramId(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mb-4"
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowEnroll(false)}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              {programs.length > 0 && (
                <button
                  onClick={handleEnroll}
                  disabled={enrollLoading}
                  className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                >
                  {enrollLoading ? 'Inscribiendo...' : 'Inscribir'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit next control date dialog */}
      {editDatePpId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-border p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Cambiar fecha de próximo control</h3>
            <input
              type="date"
              value={editDateValue}
              onChange={(e) => setEditDateValue(e.target.value)}
              min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
              max={new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm mb-4"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setEditDatePpId(null)}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleUpdateNextControl}
                disabled={editDateLoading || !editDateValue}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {editDateLoading ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Programs */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">
            Programas inscriptos ({patient.programs.length})
          </h2>
          <button
            onClick={openEnrollDialog}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Inscribir
          </button>
        </div>
        {patient.programs.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            No está inscripto en ningún programa
          </p>
        ) : (
          <div className="divide-y divide-border">
            {patient.programs.map((pp) => {
              const sc = STATUS_CONFIG[pp.status];
              return (
                <div key={pp.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{pp.program.name}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${sc.className}`}>
                        <sc.icon className="w-3 h-3" />
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {pp.status !== 'COMPLETED' && (
                        <button
                          onClick={() => handleToggleStatus(pp.id, pp.status)}
                          disabled={actionLoading === `status-${pp.id}`}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
                        >
                          {pp.status === 'ACTIVE' ? 'Pausar' : 'Reactivar'}
                        </button>
                      )}
                      {pp.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleMarkControl(pp.id)}
                          disabled={actionLoading === pp.id}
                          className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                        >
                          {actionLoading === pp.id ? 'Guardando...' : 'Marcar control'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-muted-foreground">
                    <div>
                      <span>Inscripción:</span>{' '}
                      <span className="text-foreground">{formatDate(pp.enrolledAt)}</span>
                    </div>
                    <div>
                      <span>Último control:</span>{' '}
                      <span className="text-foreground">{pp.lastControlDate ? formatDate(pp.lastControlDate) : 'Nunca'}</span>
                    </div>
                    <div>
                      <span>Próximo recordatorio:</span>{' '}
                      <span className="text-foreground">{formatDate(pp.nextReminderDate)}</span>
                      {pp.status === 'ACTIVE' && (
                        <button
                          onClick={() => openEditDate(pp.id, pp.nextReminderDate)}
                          className="ml-1 text-primary hover:text-primary/80 cursor-pointer"
                          title="Cambiar fecha"
                        >
                          <CalendarDays className="w-3 h-3 inline" />
                        </button>
                      )}
                    </div>
                    <div>
                      <span>Frecuencia:</span>{' '}
                      <span className="text-foreground">{pp.program.reminderFrequencyDays} días</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reminders */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Últimos recordatorios
          </h2>
        </div>
        {patient.reminders.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            Sin recordatorios enviados
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-slate-50/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Programa</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Fecha</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Estado</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Respondió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {patient.reminders.map((r) => {
                  const rs = REMINDER_STATUS[r.status as keyof typeof REMINDER_STATUS] || REMINDER_STATUS.PENDING;
                  return (
                    <tr key={r.id}>
                      <td className="px-4 py-2 text-sm">{r.program.name}</td>
                      <td className="px-4 py-2 text-sm text-muted-foreground tabular-nums">
                        {r.sentAt ? formatDateTime(r.sentAt) : formatDate(r.scheduledFor)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`text-xs font-medium ${rs.className}`}>{rs.label}</span>
                      </td>
                      <td className="px-4 py-2">
                        {r.patientReplied ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Clock className="w-4 h-4 text-muted-foreground" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <StickyNote className="w-4 h-4" />
            Notas operativas ({notesTotal})
          </h2>
        </div>
        {/* New note form */}
        <div className="px-5 py-4 border-b border-border">
          <div className="flex gap-2">
            <textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Escribir nota operativa..."
              maxLength={500}
              rows={2}
              className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  handleSubmitNote();
                }
              }}
            />
            <button
              onClick={handleSubmitNote}
              disabled={noteSubmitting || !noteContent.trim()}
              className="self-end px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              title="Guardar nota (Ctrl+Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex justify-between mt-1">
            <p className="text-xs text-amber-600">
              Solo notas operativas. No incluir diagnósticos ni datos clínicos.
            </p>
            <p className="text-xs text-muted-foreground">
              {noteContent.length}/500
            </p>
          </div>
        </div>
        {/* Notes list */}
        {notesError ? (
          <p className="px-5 py-8 text-sm text-red-600 text-center">{notesError}</p>
        ) : notes.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            Sin notas operativas
          </p>
        ) : (
          <div className="divide-y divide-border">
            {notes.map((note) => (
              <div key={note.id} className="px-5 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {note.doctor.fullName}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(note.createdAt)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {note.content}
                </p>
              </div>
            ))}
            {notesPage < notesPages && (
              <div className="px-5 py-3 text-center">
                <button
                  onClick={() => fetchNotes(notesPage + 1)}
                  disabled={notesLoading}
                  className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
                >
                  {notesLoading ? 'Cargando...' : 'Cargar más notas'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Conversations */}
      {patient.conversations.length > 0 && (
        <div className="bg-white rounded-lg border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Conversaciones del bot ({patient.conversations.length})
            </h2>
          </div>
          <div className="divide-y divide-border">
            {patient.conversations.map((conv) => (
              <div key={conv.id} className="px-5 py-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-foreground">{formatDateTime(conv.startedAt)}</span>
                  <span className="text-muted-foreground ml-2">
                    {conv._count.messages} mensajes
                  </span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  conv.status === 'OPEN'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  {conv.status === 'OPEN' ? 'Abierta' : 'Cerrada'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
