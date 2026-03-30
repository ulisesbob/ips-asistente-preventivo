'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPatch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ClipboardList, Pencil, Plus, X, Loader2, Users, CalendarClock, Building2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Center {
  city: string;
  name: string;
  address: string;
  _key?: string;
}

interface Program {
  id: string;
  name: string;
  description: string;
  reminderFrequencyDays: number;
  templateMessage: string;
  centers: Center[];
  activePatients: number;
}

interface EditForm {
  description: string;
  reminderFrequencyDays: number;
  templateMessage: string;
  centers: Center[];
}

// ── Page Component ─────────────────────────────────────────────────────────────

export default function ProgramasPage() {
  const { doctor } = useAuth();
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  // Edit dialog state
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [form, setForm] = useState<EditForm>({
    description: '',
    reminderFrequencyDays: 30,
    templateMessage: '',
    centers: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = doctor?.role === 'ADMIN';

  const fetchPrograms = useCallback(async () => {
    try {
      const result = await apiGet<{ programs: Program[] }>('/api/programs');
      setPrograms(result.programs);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrograms();
  }, [fetchPrograms]);

  // ── Edit dialog handlers ───────────────────────────────────────────────────

  function openEditDialog(program: Program) {
    setEditingProgram(program);
    setForm({
      description: program.description || '',
      reminderFrequencyDays: program.reminderFrequencyDays,
      templateMessage: program.templateMessage || '',
      centers: program.centers?.length
        ? program.centers.map((c, i) => ({ ...c, _key: `existing-${i}-${Date.now()}` }))
        : [],
    });
    setError(null);
  }

  function closeEditDialog() {
    setEditingProgram(null);
    setError(null);
  }

  function addCenter() {
    setForm((prev) => ({
      ...prev,
      centers: [...prev.centers, { city: '', name: '', address: '', _key: `new-${Date.now()}` }],
    }));
  }

  function removeCenter(index: number) {
    setForm((prev) => ({
      ...prev,
      centers: prev.centers.filter((_, i) => i !== index),
    }));
  }

  function updateCenter(index: number, field: keyof Center, value: string) {
    setForm((prev) => ({
      ...prev,
      centers: prev.centers.map((c, i) =>
        i === index ? { ...c, [field]: value } : c,
      ),
    }));
  }

  async function handleSave() {
    if (!editingProgram) return;

    setSaving(true);
    setError(null);

    try {
      await apiPatch(`/api/programs/${editingProgram.id}`, {
        description: form.description,
        reminderFrequencyDays: form.reminderFrequencyDays,
        templateMessage: form.templateMessage,
        centers: form.centers.map(({ city, name, address }) => ({ city, name, address })),
      });
      closeEditDialog();
      setLoading(true);
      await fetchPrograms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
        <ClipboardList className="w-5 h-5" />
        Programas
      </h1>

      {/* Program grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? [...Array(9)].map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-lg border border-border p-5 h-36 animate-pulse"
              />
            ))
          : programs.map((p) => (
              <div
                key={p.id}
                role={isAdmin ? 'button' : undefined}
                tabIndex={isAdmin ? 0 : undefined}
                onClick={isAdmin ? () => openEditDialog(p) : undefined}
                onKeyDown={isAdmin ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditDialog(p); } } : undefined}
                className={`bg-white rounded-lg border border-border p-5 transition-colors ${
                  isAdmin
                    ? 'cursor-pointer hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <h3 className="text-sm font-medium text-foreground">
                    {p.name}
                  </h3>
                  {isAdmin && (
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
                  {p.description}
                </p>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" />
                    Cada {p.reminderFrequencyDays} días
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {p.activePatients} inscriptos
                  </span>
                </div>
                {p.centers && p.centers.length > 0 && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Building2 className="w-3 h-3" />
                    <span>
                      {p.centers.length}{' '}
                      {p.centers.length === 1 ? 'centro' : 'centros'}
                    </span>
                  </div>
                )}
              </div>
            ))}
      </div>

      {!loading && programs.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">
          No hay programas registrados.
        </p>
      )}

      {/* Edit Dialog (admin only) */}
      <Dialog open={!!editingProgram} onOpenChange={(open) => !open && closeEditDialog()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar programa</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {editingProgram?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="edit-description" className="text-sm font-medium text-foreground">
                Descripción
              </label>
              <textarea
                id="edit-description"
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                maxLength={2000}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                placeholder="Descripción del programa..."
              />
              <p className="text-xs text-muted-foreground text-right">
                {form.description.length}/2000
              </p>
            </div>

            {/* Reminder frequency */}
            <div className="space-y-1.5">
              <label htmlFor="edit-frequency" className="text-sm font-medium text-foreground">
                Frecuencia de recordatorio (días)
              </label>
              <input
                id="edit-frequency"
                type="number"
                value={form.reminderFrequencyDays}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    reminderFrequencyDays: Math.max(
                      1,
                      Math.min(365, parseInt(e.target.value) || 1),
                    ),
                  }))
                }
                min={1}
                max={365}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            {/* Template message */}
            <div className="space-y-1.5">
              <label htmlFor="edit-template" className="text-sm font-medium text-foreground">
                Template de mensaje
              </label>
              <textarea
                id="edit-template"
                value={form.templateMessage}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    templateMessage: e.target.value,
                  }))
                }
                maxLength={2000}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
                placeholder="Mensaje de recordatorio..."
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Usa <code className="bg-slate-100 px-1 py-0.5 rounded text-xs">{'{{nombre}}'}</code> para el nombre del paciente
                </p>
                <p className="text-xs text-muted-foreground">
                  {form.templateMessage.length}/2000
                </p>
              </div>
            </div>

            {/* Centers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  Centros de atención
                </span>
                <button
                  type="button"
                  onClick={addCenter}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Agregar centro
                </button>
              </div>

              {form.centers.length === 0 && (
                <p className="text-xs text-muted-foreground py-3 text-center bg-slate-50 rounded-md border border-dashed border-border">
                  No hay centros configurados
                </p>
              )}

              <div className="space-y-3">
                {form.centers.map((center, index) => (
                  <div
                    key={center._key || index}
                    className="bg-slate-50 rounded-md border border-border p-3 space-y-2 relative"
                  >
                    <button
                      type="button"
                      onClick={() => removeCenter(index)}
                      className="absolute top-2 right-2 p-1 rounded-sm text-muted-foreground hover:text-foreground hover:bg-slate-200 cursor-pointer"
                      title="Eliminar centro"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pr-6">
                      <div>
                        <label htmlFor={`center-city-${index}`} className="text-xs text-muted-foreground">
                          Ciudad
                        </label>
                        <input
                          id={`center-city-${index}`}
                          type="text"
                          value={center.city}
                          onChange={(e) =>
                            updateCenter(index, 'city', e.target.value)
                          }
                          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Posadas"
                        />
                      </div>
                      <div>
                        <label htmlFor={`center-name-${index}`} className="text-xs text-muted-foreground">
                          Nombre
                        </label>
                        <input
                          id={`center-name-${index}`}
                          type="text"
                          value={center.name}
                          onChange={(e) =>
                            updateCenter(index, 'name', e.target.value)
                          }
                          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Centro de Salud N1"
                        />
                      </div>
                      <div>
                        <label htmlFor={`center-address-${index}`} className="text-xs text-muted-foreground">
                          Dirección
                        </label>
                        <input
                          id={`center-address-${index}`}
                          type="text"
                          value={center.address}
                          onChange={(e) =>
                            updateCenter(index, 'address', e.target.value)
                          }
                          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          placeholder="Av. López Torres 1234"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              onClick={closeEditDialog}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
