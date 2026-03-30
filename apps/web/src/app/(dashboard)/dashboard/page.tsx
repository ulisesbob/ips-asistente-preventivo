'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import {
  Users,
  Bell,
  Activity,
  TrendingUp,
  Calendar,
} from 'lucide-react';

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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<DashboardStats>('/api/dashboard')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
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
