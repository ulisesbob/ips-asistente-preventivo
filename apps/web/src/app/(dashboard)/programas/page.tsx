'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import { ClipboardList } from 'lucide-react';

interface Program {
  id: string;
  name: string;
  description: string;
  reminderFrequencyDays: number;
  _count?: { patientPrograms: number };
}

export default function ProgramasPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<{ programs: Program[] }>('/api/programs')
      .then((r) => setPrograms(r.programs))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <ClipboardList className="w-5 h-5" />
        Programas
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? [...Array(9)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-border p-5 h-32 animate-pulse" />
            ))
          : programs.map((p) => (
              <div key={p.id} className="bg-white rounded-lg border border-border p-5">
                <h3 className="text-sm font-medium text-foreground mb-1">{p.name}</h3>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{p.description}</p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Cada {p.reminderFrequencyDays} días</span>
                  {p._count && (
                    <span>{p._count.patientPrograms} inscriptos</span>
                  )}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
