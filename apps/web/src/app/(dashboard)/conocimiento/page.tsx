'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
} from 'lucide-react';

interface KBEntry {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  active: boolean;
}

interface KBResponse {
  items: KBEntry[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export default function ConocimientoPage() {
  const { doctor } = useAuth();
  const canEdit = !!doctor; // todos los médicos y admin pueden editar

  const [data, setData] = useState<KBResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Dialog state
  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ category: '', question: '', answer: '', sortOrder: 0 });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCategory) params.set('category', filterCategory);
      if (search) params.set('search', search);
      params.set('page', String(page));
      params.set('activeOnly', 'false');
      const result = await apiGet<KBResponse>(`/api/knowledge?${params}`);
      setData(result);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }, [filterCategory, search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    apiGet<{ categories: string[] }>('/api/knowledge/categories')
      .then((r) => setCategories(r.categories))
      .catch(() => {});
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ category: categories[0] || '', question: '', answer: '', sortOrder: 0 });
    setShowDialog(true);
  }

  function openEdit(entry: KBEntry) {
    setEditingId(entry.id);
    setForm({
      category: entry.category,
      question: entry.question,
      answer: entry.answer,
      sortOrder: entry.sortOrder,
    });
    setShowDialog(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingId) {
        await apiPatch(`/api/knowledge/${editingId}`, form);
      } else {
        await apiPost('/api/knowledge', form);
      }
      setShowDialog(false);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta entrada?')) return;
    try {
      await apiDelete(`/api/knowledge/${id}`);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al eliminar');
    }
  }

  async function handleToggleActive(entry: KBEntry) {
    try {
      await apiPatch(`/api/knowledge/${entry.id}`, { active: !entry.active });
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al cambiar estado');
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 bg-slate-100 rounded animate-pulse" />
        <div className="h-40 bg-white rounded-lg border border-border animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Base de conocimiento
        </h1>
        {canEdit && (
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1 text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Nueva entrada
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-border p-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar..."
            className="flex-1 h-9 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={filterCategory}
            onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
            className="h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            <option value="">Todas las categorías</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Entries */}
      <div className="bg-white rounded-lg border border-border">
        {!data || data.items.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground text-center">
            Sin entradas en la base de conocimiento
          </p>
        ) : (
          <div className="divide-y divide-border">
            {data.items.map((entry) => (
              <div key={entry.id} className={`px-5 py-4 ${!entry.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 mr-2">
                      {entry.category}
                    </span>
                    {!entry.active && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-50 text-red-600">
                        Inactivo
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleToggleActive(entry)}
                        className="text-xs px-2 py-1 rounded border border-input text-muted-foreground hover:bg-accent cursor-pointer"
                      >
                        {entry.active ? 'Desactivar' : 'Activar'}
                      </button>
                      <button
                        onClick={() => openEdit(entry)}
                        className="p-1 rounded text-muted-foreground hover:bg-accent cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="p-1 rounded text-red-500 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-foreground mt-2">{entry.question}</p>
                <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{entry.answer}</p>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {data && data.pagination.pages > 1 && (
          <div className="px-5 py-3 border-t border-border flex justify-center gap-2">
            {Array.from({ length: data.pagination.pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`text-xs px-2.5 py-1 rounded ${p === page ? 'bg-primary text-primary-foreground' : 'border border-input text-muted-foreground hover:bg-accent'} cursor-pointer`}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg border border-border p-6 w-full max-w-lg mx-4">
            <h3 className="text-sm font-semibold text-foreground mb-4">
              {editingId ? 'Editar entrada' : 'Nueva entrada'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Categoría</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Ej: Coberturas, Trámites, Programas..."
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                  list="categories-list"
                />
                <datalist id="categories-list">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Pregunta</label>
                <input
                  type="text"
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  placeholder="¿El IPS cubre...?"
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Respuesta</label>
                <textarea
                  value={form.answer}
                  onChange={(e) => setForm({ ...form, answer: e.target.value })}
                  rows={5}
                  placeholder="Sí, el IPS cubre..."
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1 text-right">{form.answer.length}/2000</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setShowDialog(false)}
                className="text-xs px-3 py-2 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.category.trim() || !form.question.trim() || !form.answer.trim()}
                className="text-xs px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
