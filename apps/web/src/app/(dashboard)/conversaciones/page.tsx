'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Filter,
} from 'lucide-react';

interface Conversation {
  id: string;
  phone: string;
  status: 'OPEN' | 'CLOSED';
  startedAt: string;
  closedAt: string | null;
  patient: { id: string; fullName: string; dni: string } | null;
  _count: { messages: number };
}

interface ConversationsResponse {
  conversations: Conversation[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function ConversacionesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<ConversationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);

  // Debounce search input (400ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('limit', '20');

    try {
      const result = await apiGet<ConversationsResponse>(`/api/conversations?${params}`);
      setData(result);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    router.replace(`/conversaciones${qs ? `?${qs}` : ''}`, { scroll: false });
  }, [debouncedSearch, status, page, router]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <MessageSquare className="w-5 h-5" />
          Conversaciones
        </h1>
        <span className="text-sm text-muted-foreground">
          {data ? `${data.pagination.total} conversaciones` : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-border p-4">
        <form onSubmit={handleSearchSubmit} className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por nombre, DNI o teléfono..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            />
          </div>

          {/* Status filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="h-9 pl-8 pr-8 rounded-md border border-input bg-background text-sm appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
            >
              <option value="">Todas</option>
              <option value="OPEN">Abiertas</option>
              <option value="CLOSED">Cerradas</option>
            </select>
          </div>
        </form>
      </div>

      {/* Error banner */}
      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-red-700">Error al cargar conversaciones. Verificá tu conexión.</p>
          <button
            onClick={fetchConversations}
            className="text-xs text-red-700 underline hover:text-red-900 cursor-pointer"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-slate-50/50">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Paciente</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Teléfono</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Mensajes</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Estado</th>
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Fecha inicio</th>
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
              ) : data && data.conversations.length > 0 ? (
                data.conversations.map((conv) => (
                  <tr
                    key={conv.id}
                    className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/conversaciones/${conv.id}`)}
                  >
                    <td className="px-4 py-3">
                      {conv.patient ? (
                        <div>
                          <span className="text-sm font-medium text-foreground">
                            {conv.patient.fullName}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            DNI {conv.patient.dni}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground italic">
                          Sin identificar
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {conv.phone}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {conv._count.messages}
                    </td>
                    <td className="px-4 py-3">
                      {conv.status === 'OPEN' ? (
                        <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                          Abierta
                        </span>
                      ) : (
                        <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">
                          Cerrada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                      {formatDate(conv.startedAt)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No se encontraron conversaciones
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
