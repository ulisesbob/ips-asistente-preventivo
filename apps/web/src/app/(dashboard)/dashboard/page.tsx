'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { useRouter } from 'next/navigation';
import {
  Users,
  Bell,
  Activity,
  TrendingUp,
  Calendar,
  AlertTriangle,
  AlertCircle,
  PhoneOff,
  MessageSquareOff,
  Star,
  ClipboardCheck,
} from 'lucide-react';

interface AlertPatient {
  id: string;
  fullName: string;
  dni: string;
  programName: string;
  daysOverdue?: number;
  missedReminders?: number;
}

interface DashboardAlerts {
  overdueWarning: AlertPatient[];
  overdueCritical: AlertPatient[];
  noResponse: AlertPatient[];
  optedOut: AlertPatient[];
}

interface SurveyStats {
  totalSent: number;
  totalCompleted: number;
  attendanceRate: number;
  averageRating: number;
  ratingDistribution: { rating: number; count: number }[];
}

interface DashboardStats {
  totalPatients: number;
  activePrograms: number;
  remindersSentToday: number;
  remindersSentWeek: number;
  remindersSentMonth: number;
  responseRate: number;
  patientsByProgram: { programName: string; count: number }[];
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [alerts, setAlerts] = useState<DashboardAlerts | null>(null);
  const [surveyStats, setSurveyStats] = useState<SurveyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiGet<DashboardStats>('/api/dashboard').catch(() => null),
      apiGet<DashboardAlerts>('/api/dashboard/alerts').catch(() => null),
      apiGet<SurveyStats>('/api/dashboard/surveys').catch(() => null),
    ]).then(([s, a, sv]) => {
      if (s) setStats(s);
      if (a) setAlerts(a);
      if (sv) setSurveyStats(sv);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-border p-5 h-[104px] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">No se pudieron cargar las estadísticas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Pacientes totales"
          value={stats.totalPatients}
          icon={Users}
        />
        <StatCard
          label="Programas activos"
          value={stats.activePrograms}
          icon={Activity}
          sub="inscripciones activas"
        />
        <StatCard
          label="Recordatorios hoy"
          value={stats.remindersSentToday}
          icon={Bell}
          sub={`${stats.remindersSentWeek} esta semana`}
        />
        <StatCard
          label="Tasa de respuesta"
          value={`${stats.responseRate}%`}
          icon={TrendingUp}
          sub="últimos 30 días"
        />
      </div>

      {/* Alerts */}
      {alerts && (alerts.overdueCritical.length > 0 || alerts.overdueWarning.length > 0 || alerts.noResponse.length > 0 || alerts.optedOut.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Alertas
          </h2>

          {/* Critical — overdue >60 days */}
          {alerts.overdueCritical.length > 0 && (
            <div className="bg-white rounded-lg border border-red-200">
              <div className="px-5 py-3 border-b border-red-100 bg-red-50/50">
                <h3 className="text-xs font-medium text-red-700 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Control vencido &gt;60 días ({alerts.overdueCritical.length})
                </h3>
              </div>
              <div className="divide-y divide-border">
                {alerts.overdueCritical.map((p) => (
                  <button key={`crit-${p.id}-${p.programName}`} onClick={() => router.push(`/pacientes/${p.id}`)} className="w-full px-5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer">
                    <div className="text-sm">
                      <span className="text-foreground font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground ml-2">DNI {p.dni}</span>
                      <span className="text-muted-foreground ml-2">— {p.programName}</span>
                    </div>
                    <span className="text-xs font-medium text-red-600">{p.daysOverdue} días</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Warning — overdue >30 days */}
          {alerts.overdueWarning.length > 0 && (
            <div className="bg-white rounded-lg border border-amber-200">
              <div className="px-5 py-3 border-b border-amber-100 bg-amber-50/50">
                <h3 className="text-xs font-medium text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Control vencido &gt;30 días ({alerts.overdueWarning.length})
                </h3>
              </div>
              <div className="divide-y divide-border">
                {alerts.overdueWarning.map((p) => (
                  <button key={`warn-${p.id}-${p.programName}`} onClick={() => router.push(`/pacientes/${p.id}`)} className="w-full px-5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer">
                    <div className="text-sm">
                      <span className="text-foreground font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground ml-2">DNI {p.dni}</span>
                      <span className="text-muted-foreground ml-2">— {p.programName}</span>
                    </div>
                    <span className="text-xs font-medium text-amber-600">{p.daysOverdue} días</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* No response — 3+ reminders */}
          {alerts.noResponse.length > 0 && (
            <div className="bg-white rounded-lg border border-orange-200">
              <div className="px-5 py-3 border-b border-orange-100 bg-orange-50/50">
                <h3 className="text-xs font-medium text-orange-700 flex items-center gap-1.5">
                  <MessageSquareOff className="w-3.5 h-3.5" />
                  Sin respuesta a recordatorios ({alerts.noResponse.length})
                </h3>
              </div>
              <div className="divide-y divide-border">
                {alerts.noResponse.map((p) => (
                  <button key={`nr-${p.id}`} onClick={() => router.push(`/pacientes/${p.id}`)} className="w-full px-5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer">
                    <div className="text-sm">
                      <span className="text-foreground font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground ml-2">DNI {p.dni}</span>
                      <span className="text-muted-foreground ml-2">— {p.programName}</span>
                    </div>
                    <span className="text-xs font-medium text-orange-600">{p.missedReminders} sin respuesta</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Opted out */}
          {alerts.optedOut.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200">
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                <h3 className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                  <PhoneOff className="w-3.5 h-3.5" />
                  Solicitaron baja ({alerts.optedOut.length})
                </h3>
              </div>
              <div className="divide-y divide-border">
                {alerts.optedOut.map((p) => (
                  <button key={`out-${p.id}`} onClick={() => router.push(`/pacientes/${p.id}`)} className="w-full px-5 py-2.5 flex items-center justify-between text-left hover:bg-slate-50 cursor-pointer">
                    <div className="text-sm">
                      <span className="text-foreground font-medium">{p.fullName}</span>
                      <span className="text-muted-foreground ml-2">DNI {p.dni}</span>
                      <span className="text-muted-foreground ml-2">— {p.programName}</span>
                    </div>
                    <span className="text-xs text-slate-500">BAJA</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Survey stats */}
      {surveyStats && surveyStats.totalSent > 0 && (
        <div className="bg-white rounded-lg border border-border">
          <div className="px-5 py-4 border-b border-border">
            <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4" />
              Encuestas de satisfacción
            </h2>
          </div>
          <div className="px-5 py-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Enviadas</span>
                <p className="text-lg font-semibold">{surveyStats.totalSent}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Completadas</span>
                <p className="text-lg font-semibold">{surveyStats.totalCompleted}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Asistencia</span>
                <p className="text-lg font-semibold">{surveyStats.attendanceRate}%</p>
              </div>
              <div>
                <span className="text-muted-foreground">Calificación</span>
                <p className="text-lg font-semibold flex items-center gap-1">
                  <Star className="w-4 h-4 text-amber-500" />
                  {surveyStats.averageRating}/5
                </p>
              </div>
            </div>
            {surveyStats.ratingDistribution.length > 0 && (
              <div className="mt-4 flex gap-2">
                {[1, 2, 3, 4, 5].map((r) => {
                  const entry = surveyStats.ratingDistribution.find((d) => d.rating === r);
                  const count = entry?.count ?? 0;
                  const maxCount = Math.max(...surveyStats.ratingDistribution.map((d) => d.count), 1);
                  return (
                    <div key={r} className="flex-1 text-center">
                      <div className="h-16 flex items-end justify-center">
                        <div
                          className="w-full max-w-[24px] bg-amber-200 rounded-t"
                          style={{ height: `${(count / maxCount) * 100}%`, minHeight: count > 0 ? '4px' : '0' }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{r}★</p>
                      <p className="text-xs font-medium">{count}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Patients by program */}
      <div className="bg-white rounded-lg border border-border">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-sm font-medium text-foreground flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Pacientes por programa
          </h2>
        </div>
        <div className="divide-y divide-border">
          {stats.patientsByProgram.length === 0 ? (
            <p className="px-5 py-8 text-sm text-muted-foreground text-center">
              Sin inscripciones activas
            </p>
          ) : (
            stats.patientsByProgram.map((item) => (
              <div key={item.programName} className="px-5 py-3 flex items-center justify-between">
                <span className="text-sm text-foreground">{item.programName}</span>
                <span className="text-sm font-medium text-foreground tabular-nums">
                  {item.count}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
