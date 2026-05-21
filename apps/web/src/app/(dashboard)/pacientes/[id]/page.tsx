'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDateTime, formatDateOnly } from '@/lib/utils';
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
  Pencil,
  Pill,
  Trash2,
  UserPlus,
  AlertCircle,
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
  lastNoProgramReminderAt: string | null;
  noProgramReminderCount: number;
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
  // Nullable: las autoinscripciones por bot (fase 2) no tienen médico.
  enrolledByDoctor: { fullName: string } | null;
  // Origen + estado de revisión de la inscripción (fase 2).
  enrolledVia: 'DOCTOR' | 'BOT';
  reviewedAt: string | null;
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

interface MedReminder {
  id: string;
  medicationName: string;
  dosage: string;
  reminderHour: number;
  reminderMinute: number;
  active: boolean;
  endDate: string | null;
  instructions: string | null;
  sideEffects: string | null;
  doctor: { fullName: string } | null;
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
  const [fetchError, setFetchError] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showEnroll, setShowEnroll] = useState(false);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState('');
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [editDatePpId, setEditDatePpId] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState('');
  const [editDateLoading, setEditDateLoading] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ fullName: '', phone: '', birthDate: '', gender: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [meds, setMeds] = useState<MedReminder[]>([]);
  const [showMedDialog, setShowMedDialog] = useState(false);
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [medForm, setMedForm] = useState({
    medicationName: '',
    dosage: '',
    reminderHour: 8,
    reminderMinute: 0,
    durationType: 'continuo' as 'continuo' | 'dias',
    durationDays: 30,
    instructions: '',
    sideEffects: '',
  });
  const [medSaving, setMedSaving] = useState(false);
  const [notes, setNotes] = useState<PatientNoteItem[]>([]);
  const [notesPage, setNotesPage] = useState(1);
  const [notesTotal, setNotesTotal] = useState(0);
  const [notesPages, setNotesPages] = useState(0);
  const [noteContent, setNoteContent] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const notesLoadingRef = useRef(false);
  const [notesLoadMore, setNotesLoadMore] = useState(false);

  const fetchPatient = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiGet<{ patient: PatientDetail }>(`/api/patients/${id}`);
      setPatient(result.patient);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const [notesError, setNotesError] = useState<string | null>(null);

  const fetchNotes = useCallback(async (page = 1) => {
    if (notesLoadingRef.current) return;
    notesLoadingRef.current = true;
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
      notesLoadingRef.current = false;
    }
  }, [id]);

  async function handleSubmitNote() {
    const trimmed = noteContent.trim();
    if (!trimmed || noteSubmitting) return;
    setNoteSubmitting(true);
    try {
      await apiPost(`/api/patients/${id}/notes`, { content: trimmed });
      setNoteContent('');
      await fetchNotes(1);
      toast.success('Nota guardada');
    } catch {
      toast.error('No se pudo guardar la nota');
    } finally {
      setNoteSubmitting(false);
    }
  }

  const fetchMeds = useCallback(async () => {
    try {
      const result = await apiGet<{ reminders: MedReminder[] }>(`/api/patients/${id}/medications`);
      setMeds(result.reminders);
    } catch {
      toast.error('No se pudieron cargar las medicaciones');
    }
  }, [id]);

  function resetMedForm() {
    setEditingMedId(null);
    setMedForm({
      medicationName: '',
      dosage: '',
      reminderHour: 8,
      reminderMinute: 0,
      durationType: 'continuo',
      durationDays: 30,
      instructions: '',
      sideEffects: '',
    });
  }

  function openEditMed(med: MedReminder) {
    setEditingMedId(med.id);
    setMedForm({
      medicationName: med.medicationName,
      dosage: med.dosage,
      reminderHour: med.reminderHour,
      reminderMinute: med.reminderMinute === 30 ? 30 : 0,
      durationType: med.endDate ? 'dias' : 'continuo',
      // endDate es @db.Date (medianoche UTC). Anclamos "hoy" a medianoche UTC para
      // que los días restantes sean EXACTOS: así re-guardar sin tocar la duración
      // NO corre la fecha de fin (el backend recalcula endDate = hoyUTC + N, y un N
      // exacto reproduce el endDate original). Crítico: son datos clínicos.
      durationDays: med.endDate
        ? Math.max(
            1,
            Math.round(
              (Date.parse(med.endDate) -
                Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())) /
                86400000
            )
          )
        : 30,
      instructions: med.instructions ?? '',
      sideEffects: med.sideEffects ?? '',
    });
    setShowMedDialog(true);
  }

  async function handleSaveMed() {
    if (!medForm.medicationName.trim() || !medForm.dosage.trim()) return;
    setMedSaving(true);
    try {
      if (editingMedId) {
        const body: {
          medicationName: string;
          dosage: string;
          reminderHour: number;
          reminderMinute: number;
          durationDays: number | null;
          instructions: string | null;
          sideEffects: string | null;
        } = {
          medicationName: medForm.medicationName.trim(),
          dosage: medForm.dosage.trim(),
          reminderHour: medForm.reminderHour,
          reminderMinute: medForm.reminderMinute,
          durationDays: medForm.durationType === 'dias' ? medForm.durationDays : null,
          instructions: medForm.instructions.trim() || null,
          sideEffects: medForm.sideEffects.trim() || null,
        };
        await apiPatch(`/api/medication-reminders/${editingMedId}`, body);
        setShowMedDialog(false);
        resetMedForm();
        await fetchMeds();
        toast.success('Recordatorio actualizado');
      } else {
        const body: {
          medicationName: string;
          dosage: string;
          reminderHour: number;
          reminderMinute: number;
          durationDays?: number;
          instructions?: string;
          sideEffects?: string;
        } = {
          medicationName: medForm.medicationName,
          dosage: medForm.dosage,
          reminderHour: medForm.reminderHour,
          reminderMinute: medForm.reminderMinute,
        };
        if (medForm.durationType === 'dias') body.durationDays = medForm.durationDays;
        if (medForm.instructions.trim()) body.instructions = medForm.instructions.trim();
        if (medForm.sideEffects.trim()) body.sideEffects = medForm.sideEffects.trim();

        await apiPost(`/api/patients/${id}/medications`, body);
        setShowMedDialog(false);
        resetMedForm();
        await fetchMeds();
        toast.success('Recordatorio de medicación creado');
      }
    } catch {
      toast.error(editingMedId ? 'No se pudo actualizar el recordatorio' : 'No se pudo crear el recordatorio');
    } finally {
      setMedSaving(false);
    }
  }

  async function handleToggleMed(med: MedReminder) {
    try {
      await apiPatch(`/api/medication-reminders/${med.id}`, { active: !med.active });
      await fetchMeds();
      toast.success(med.active ? 'Recordatorio pausado' : 'Recordatorio activado');
    } catch {
      toast.error('No se pudo cambiar el estado del recordatorio');
    }
  }

  async function handleDeleteMed(medId: string) {
    if (!confirm('¿Eliminar este recordatorio de medicación?')) return;
    try {
      await apiDelete(`/api/medication-reminders/${medId}`);
      await fetchMeds();
      toast.success('Recordatorio eliminado');
    } catch {
      toast.error('No se pudo eliminar el recordatorio');
    }
  }

  useEffect(() => {
    fetchPatient();
    fetchNotes(1);
    fetchMeds();
  }, [fetchPatient, fetchNotes, fetchMeds]);

  async function openEnrollDialog() {
    try {
      const data = await apiGet<{ programs: { id: string; name: string }[] }>('/api/programs');
      const enrolledIds = new Set(patient?.programs.map((pp) => pp.program.id) ?? []);
      const available = data.programs.filter((p) => !enrolledIds.has(p.id));
      setPrograms(available);
      setSelectedProgramId(available[0]?.id ?? '');
      setShowEnroll(true);
    } catch {
      toast.error('No se pudieron cargar los programas');
    }
  }

  async function handleEnroll() {
    if (!selectedProgramId) return;
    setEnrollLoading(true);
    try {
      await apiPost(`/api/patients/${id}/programs`, { programId: selectedProgramId });
      setShowEnroll(false);
      await fetchPatient();
      toast.success('Paciente inscripto en el programa');
    } catch {
      toast.error('No se pudo inscribir al paciente en el programa');
    } finally {
      setEnrollLoading(false);
    }
  }

  async function handleMarkControl(ppId: string) {
    setActionLoading(ppId);
    try {
      await apiPost(`/api/patient-programs/${ppId}/control`, {});
      await fetchPatient();
      toast.success('Control registrado');
    } catch {
      toast.error('No se pudo registrar el control');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleToggleStatus(ppId: string, currentStatus: string) {
    const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    if (newStatus === 'PAUSED' && !confirm('Pausar el programa corta los recordatorios automáticos al paciente. ¿Continuar?')) {
      return;
    }
    setActionLoading(`status-${ppId}`);
    try {
      await apiPatch(`/api/patient-programs/${ppId}`, { status: newStatus });
      await fetchPatient();
      toast.success(newStatus === 'PAUSED' ? 'Programa pausado' : 'Programa reactivado');
    } catch {
      toast.error('No se pudo cambiar el estado del programa');
    } finally {
      setActionLoading(null);
    }
  }

  function openEditDate(ppId: string, currentDate: string) {
    // currentDate is ISO string like "2026-04-15T00:00:00.000Z" — extract YYYY-MM-DD
    setEditDateValue(currentDate.slice(0, 10));
    setEditDatePpId(ppId);
  }

  function openEditDialog() {
    if (!patient) return;
    setEditForm({
      fullName: patient.fullName,
      phone: patient.phone || '',
      birthDate: patient.birthDate ? patient.birthDate.slice(0, 10) : '',
      gender: patient.gender || '',
    });
    setShowEdit(true);
  }

  async function handleEditPatient() {
    if (!patient) return;
    setEditLoading(true);
    try {
      const body: Record<string, string | null | undefined> = {};
      if (editForm.fullName !== patient.fullName) body.fullName = editForm.fullName;
      if (editForm.phone !== (patient.phone || '')) body.phone = editForm.phone || null;
      if (editForm.birthDate !== (patient.birthDate ? patient.birthDate.slice(0, 10) : '')) body.birthDate = editForm.birthDate || undefined;
      if (editForm.gender !== (patient.gender || '')) body.gender = editForm.gender || undefined;

      if (Object.keys(body).length === 0) {
        toast('No hay cambios para guardar');
        return;
      }

      await apiPatch(`/api/patients/${id}`, body);
      setShowEdit(false);
      await fetchPatient();
      toast.success('Datos actualizados');
    } catch {
      toast.error('No se pudieron guardar los datos del paciente');
    } finally {
      setEditLoading(false);
    }
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
      toast.success('Fecha de próximo control actualizada');
    } catch {
      toast.error('No se pudo actualizar la fecha de próximo control');
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
        {fetchError ? (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              No se pudo cargar el paciente. Verificá tu conexión.
            </p>
            <button
              onClick={() => fetchPatient()}
              className="text-xs text-red-700 underline hover:text-red-900 cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Paciente no encontrado.</p>
        )}
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
            <button
              onClick={openEditDialog}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            >
              <Pencil className="w-3 h-3" /> Editar
            </button>
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

      {/* Edit patient dialog */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-border p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">Editar paciente</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Nombre completo</label>
                <input
                  type="text"
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">DNI (no editable)</label>
                <input
                  type="text"
                  value={patient?.dni ?? ''}
                  disabled
                  className="w-full h-9 px-3 rounded-md border border-input bg-slate-50 text-sm text-muted-foreground"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Teléfono (E.164, ej: +5493764123456)</label>
                <input
                  type="text"
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  placeholder="+5493764123456"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Fecha de nacimiento</label>
                <input
                  type="date"
                  value={editForm.birthDate}
                  onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Género</label>
                <select
                  value={editForm.gender}
                  onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="">Sin especificar</option>
                  <option value="M">Masculino</option>
                  <option value="F">Femenino</option>
                  <option value="OTRO">Otro</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setShowEdit(false)}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleEditPatient}
                disabled={editLoading || !editForm.fullName.trim()}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {editLoading ? 'Guardando...' : 'Guardar'}
              </button>
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
              max={(() => { const d = new Date(); d.setFullYear(d.getFullYear() + 2); return d.toISOString().slice(0, 10); })()}
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

      {/* Followup status — paciente registrado por bot, sin programa */}
      {patient.programs.length === 0 && patient.noProgramReminderCount > 0 && (
        <div className={`rounded-lg border p-4 ${
          patient.noProgramReminderCount >= 3
            ? 'bg-rose-50 border-rose-200'
            : 'bg-sky-50 border-sky-200'
        }`}>
          <div className="flex items-start gap-3">
            {patient.noProgramReminderCount >= 3 ? (
              <AlertCircle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
            ) : (
              <UserPlus className="w-4 h-4 text-sky-600 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 text-sm">
              <p className={`font-medium ${
                patient.noProgramReminderCount >= 3 ? 'text-rose-800' : 'text-sky-800'
              }`}>
                {patient.noProgramReminderCount >= 3
                  ? 'Sin programa tras 3 recordatorios — requiere acción'
                  : `Recibiendo seguimiento para inscribirse (${patient.noProgramReminderCount}/3 avisos enviados)`}
              </p>
              <p className={`text-xs mt-1 ${
                patient.noProgramReminderCount >= 3 ? 'text-rose-700' : 'text-sky-700'
              }`}>
                {patient.noProgramReminderCount >= 3
                  ? 'Ya recibió los 3 recordatorios automáticos para acercarse al Área de Programas Especiales y no se inscribió en ninguno. Inscribilo manualmente o contactalo.'
                  : 'El sistema le está pidiendo automáticamente que se acerque al Área de Programas Especiales con DNI y carnet del IPS.'}
                {patient.lastNoProgramReminderAt && (
                  <> Último aviso: {formatDateTime(patient.lastNoProgramReminderAt)}.</>
                )}
              </p>
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{pp.program.name}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${sc.className}`}>
                        <sc.icon className="w-3 h-3" />
                        {sc.label}
                      </span>
                      {pp.enrolledVia === 'BOT' && !pp.reviewedAt && (
                        <span
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700"
                          title="El paciente se autoinscribió por WhatsApp. Validá la inscripción y, si corresponde, marcá un control."
                        >
                          <AlertCircle className="w-3 h-3" />
                          Autoinscripción por bot · revisar
                        </span>
                      )}
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

      {/* Medication reminders */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Pill className="w-4 h-4" />
            Recordatorios de medicación ({meds.length})
          </h2>
          <button
            onClick={() => { resetMedForm(); setShowMedDialog(true); }}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar
          </button>
        </div>
        {meds.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            Sin recordatorios de medicación configurados
          </p>
        ) : (
          <div className="divide-y divide-border">
            {meds.map((med) => (
              <div key={med.id} className={`px-5 py-3 flex items-start justify-between gap-3 ${!med.active ? 'opacity-50' : ''}`}>
                <div>
                  <span className="text-sm font-medium text-foreground">{med.medicationName}</span>
                  <span className="text-sm text-muted-foreground ml-2">— {med.dosage}</span>
                  <span className="text-xs text-muted-foreground ml-3">
                    ⏰ {String(med.reminderHour).padStart(2, '0')}:{String(med.reminderMinute).padStart(2, '0')} hs
                  </span>
                  <span className="text-xs text-muted-foreground ml-3">
                    📅 {med.endDate ? `Hasta ${formatDateOnly(med.endDate)}` : 'Continuo'}
                  </span>
                  {med.doctor ? (
                    <span className="text-xs text-muted-foreground ml-2">({med.doctor.fullName})</span>
                  ) : (
                    <span className="text-xs ml-2 px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">Creado por el paciente</span>
                  )}
                  {med.instructions && (
                    <p className="text-xs text-muted-foreground mt-1">📋 {med.instructions}</p>
                  )}
                  {med.sideEffects && (
                    <p className="text-xs text-amber-600 mt-1">⚠️ Efectos secundarios: {med.sideEffects}</p>
                  )}
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => openEditMed(med)}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-input text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" /> Editar
                  </button>
                  <button
                    onClick={() => handleToggleMed(med)}
                    className="text-xs px-2 py-1 rounded border border-input text-muted-foreground hover:bg-accent cursor-pointer"
                  >
                    {med.active ? 'Pausar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => handleDeleteMed(med.id)}
                    className="p-1 rounded text-red-500 hover:bg-red-50 cursor-pointer"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Medication dialog */}
      {showMedDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-border p-6 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">{editingMedId ? 'Editar recordatorio de medicación' : 'Nuevo recordatorio de medicación'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Medicamento</label>
                <input
                  type="text"
                  value={medForm.medicationName}
                  onChange={(e) => setMedForm({ ...medForm, medicationName: e.target.value })}
                  placeholder="Ej: Insulina, Metformina..."
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Dosis</label>
                <input
                  type="text"
                  value={medForm.dosage}
                  onChange={(e) => setMedForm({ ...medForm, dosage: e.target.value })}
                  placeholder="Ej: 500mg, 10 unidades..."
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Hora</label>
                  <select
                    value={medForm.reminderHour}
                    onChange={(e) => setMedForm({ ...medForm, reminderHour: parseInt(e.target.value) })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Minutos</label>
                  <select
                    value={medForm.reminderMinute}
                    onChange={(e) => setMedForm({ ...medForm, reminderMinute: parseInt(e.target.value) })}
                    className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value={0}>:00</option>
                    <option value={30}>:30</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                El paciente recibirá un mensaje por WhatsApp todos los días a esta hora (Argentina).
              </p>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Duración</label>
                <select
                  value={medForm.durationType}
                  onChange={(e) => setMedForm({ ...medForm, durationType: e.target.value as 'continuo' | 'dias' })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                >
                  <option value="continuo">Continuo</option>
                  <option value="dias">Por X días</option>
                </select>
                {medForm.durationType === 'dias' && (
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={medForm.durationDays}
                    onChange={(e) => setMedForm({ ...medForm, durationDays: parseInt(e.target.value) || 1 })}
                    placeholder="Cantidad de días (1-365)"
                    className="w-full h-9 px-3 mt-2 rounded-md border border-input bg-background text-sm"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Instrucciones</label>
                <textarea
                  value={medForm.instructions}
                  onChange={(e) => setMedForm({ ...medForm, instructions: e.target.value })}
                  placeholder="Ej: tomar con comida, comer antes de la insulina"
                  rows={2}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  El bot se lo manda al paciente en cada recordatorio.
                </p>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Efectos secundarios</label>
                <textarea
                  value={medForm.sideEffects}
                  onChange={(e) => setMedForm({ ...medForm, sideEffects: e.target.value })}
                  placeholder="Opcional"
                  rows={2}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Solo lo que un médico haya validado.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => { setShowMedDialog(false); resetMedForm(); }}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveMed}
                disabled={medSaving || !medForm.medicationName.trim() || !medForm.dosage.trim()}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {medSaving ? 'Guardando...' : editingMedId ? 'Guardar cambios' : 'Crear recordatorio'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  onClick={async () => { setNotesLoadMore(true); await fetchNotes(notesPage + 1); setNotesLoadMore(false); }}
                  disabled={notesLoadMore}
                  className="text-xs text-primary hover:underline cursor-pointer disabled:opacity-50"
                >
                  {notesLoadMore ? 'Cargando...' : 'Cargar más notas'}
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
              <div
                key={conv.id}
                onClick={() => router.push(`/conversaciones/${conv.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    router.push(`/conversaciones/${conv.id}`);
                  }
                }}
                className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset"
              >
                <div className="text-sm">
                  <span className="text-foreground">{formatDateTime(conv.startedAt)}</span>
                  <span className="text-muted-foreground ml-2">
                    {conv._count.messages} mensajes
                  </span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  conv.status === 'OPEN'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : conv.status === 'ESCALATED'
                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  {conv.status === 'OPEN' ? 'Abierta' : conv.status === 'ESCALATED' ? 'Escalada' : 'Cerrada'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
