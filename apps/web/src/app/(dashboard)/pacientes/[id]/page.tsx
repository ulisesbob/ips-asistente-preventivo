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
  message: string;
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

  useEffect(() => {
    fetchPatient();
  }, [fetchPatient]);

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

      {/* Programs */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">
            Programas inscriptos ({patient.programs.length})
          </h2>
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
                        <>
                          <button
                            onClick={() => handleToggleStatus(pp.id, pp.status)}
                            disabled={actionLoading === `status-${pp.id}`}
                            className="text-xs px-2.5 py-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
                          >
                            {pp.status === 'ACTIVE' ? 'Pausar' : 'Reactivar'}
                          </button>
                          <button
                            onClick={() => handleMarkControl(pp.id)}
                            disabled={actionLoading === pp.id}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
                          >
                            {actionLoading === pp.id ? 'Guardando...' : 'Marcar control'}
                          </button>
                        </>
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
