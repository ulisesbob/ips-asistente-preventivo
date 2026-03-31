'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiGet, apiPost } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import {
  ArrowLeft,
  MessageSquare,
  Loader2,
  Send,
  PhoneForwarded,
  XCircle,
} from 'lucide-react';

interface Message {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  createdAt: string;
}

interface ConversationDetail {
  id: string;
  phone: string;
  status: 'OPEN' | 'ESCALATED' | 'CLOSED';
  startedAt: string;
  patientName: string | null;
}

interface MessagesResponse {
  conversation: ConversationDetail;
  messages: Message[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export default function ConversacionDetallePage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<MessagesResponse | null>(null);
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const chatRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const fetchMessages = useCallback(async (pageNum: number, append: boolean) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await apiGet<MessagesResponse>(
        `/api/conversations/${id}/messages?page=${pageNum}&limit=50`
      );
      setData(result);

      if (append) {
        // API returns messages ASC by createdAt — page 2+ = newer messages, append at end
        setAllMessages((prev) => [...prev, ...result.messages]);
      } else {
        setAllMessages(result.messages);
      }
    } catch {
      // Error handled silently
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [id]);

  useEffect(() => {
    fetchMessages(1, false);
  }, [fetchMessages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!loading && chatRef.current && !initialScrollDone.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
      initialScrollDone.current = true;
    }
  }, [loading]);

  async function handleLoadMore() {
    const nextPage = page + 1;
    try {
      await fetchMessages(nextPage, true);
      setPage(nextPage);
    } catch {
      // Page not incremented — user can retry
    }
  }

  async function handleReply() {
    if (!replyText.trim() || replying) return;
    setReplying(true);
    try {
      await apiPost(`/api/conversations/${id}/reply`, { message: replyText.trim() });
      setReplyText('');
      await fetchMessages(1, false);
      // Scroll to bottom after sending
      setTimeout(() => {
        if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }, 100);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al enviar');
    } finally {
      setReplying(false);
    }
  }

  const hasMorePages = data ? data.pagination.page < data.pagination.pages : false;

  if (loading) {
    return (
      <div className="space-y-4">
        {/* Header skeleton */}
        <div className="bg-white rounded-lg border border-border p-4">
          <div className="h-5 w-48 bg-slate-100 rounded animate-pulse mb-2" />
          <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
        </div>
        {/* Messages skeleton */}
        <div className="bg-white rounded-lg border border-border p-4 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
              <div className="h-12 w-64 bg-slate-100 rounded-2xl animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/conversaciones')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Conversaciones
        </button>
        <div className="bg-white rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
          No se pudo cargar la conversación
        </div>
      </div>
    );
  }

  const { conversation } = data;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg border border-border p-4">
        <button
          onClick={() => router.push('/conversaciones')}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          Conversaciones
        </button>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                {conversation.patientName || conversation.phone}
              </h1>
              <p className="text-sm text-muted-foreground">
                {conversation.phone}
                <span className="ml-2">
                  · Inicio: {formatDateTime(conversation.startedAt)}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conversation.status === 'ESCALATED' && (
              <button
                onClick={async () => {
                  if (!confirm('¿Cerrar esta conversación escalada?')) return;
                  try {
                    await apiPost(`/api/conversations/${id}/close`, {});
                    await fetchMessages(1, false);
                  } catch (err) {
                    alert(err instanceof Error ? err.message : 'Error');
                  }
                }}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-input text-muted-foreground hover:bg-accent cursor-pointer"
              >
                <XCircle className="w-3 h-3" /> Cerrar
              </button>
            )}
            {conversation.status === 'OPEN' ? (
              <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                Abierta
              </span>
            ) : conversation.status === 'ESCALATED' ? (
              <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border bg-orange-50 text-orange-700 border-orange-200">
                <PhoneForwarded className="w-3 h-3" /> Escalada
              </span>
            ) : (
              <span className="inline-flex text-xs px-2 py-0.5 rounded border bg-slate-50 text-slate-600 border-slate-200">
                Cerrada
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Chat messages */}
      <div className="bg-white rounded-lg border border-border">
        <div
          ref={chatRef}
          className="flex flex-col gap-3 p-4 max-h-[600px] overflow-y-auto"
        >
          {/* Messages */}
          {allMessages.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay mensajes en esta conversación
            </div>
          ) : (
            allMessages.map((msg) => {
              if (msg.role === 'SYSTEM') {
                return (
                  <div key={msg.id} className="mx-auto text-xs text-muted-foreground italic max-w-[85%] text-center py-1">
                    <p>{msg.content}</p>
                    <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
                      {formatDateTime(msg.createdAt)}
                    </span>
                  </div>
                );
              }

              if (msg.role === 'USER') {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="ml-auto max-w-[75%] bg-primary/10 rounded-2xl rounded-br-sm px-4 py-2">
                      <p className="text-xs font-medium text-primary/70 mb-1">Paciente</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-[10px] text-muted-foreground mt-1 text-right">
                        {formatDateTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              }

              // ASSISTANT
              return (
                <div key={msg.id} className="flex justify-start">
                  <div className="mr-auto max-w-[75%] bg-white border border-border rounded-2xl rounded-bl-sm px-4 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Asistente IPS</p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {formatDateTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })
          )}

          {/* Load more button — loads next chronological batch */}
          {hasMorePages && (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground border border-input rounded-md px-3 py-1.5 hover:bg-accent transition-colors disabled:opacity-40 cursor-pointer"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Cargando...
                  </>
                ) : (
                  `Cargar más (${data.pagination.total - allMessages.length} restantes)`
                )}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Reply form for ESCALATED conversations */}
      {conversation.status === 'ESCALATED' && (
        <div className="bg-white rounded-lg border border-border p-4">
          <div className="flex gap-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Escribí tu respuesta al paciente..."
              rows={2}
              maxLength={4096}
              className="flex-1 px-3 py-2 rounded-md border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  handleReply();
                }
              }}
            />
            <button
              onClick={handleReply}
              disabled={replying || !replyText.trim()}
              className="self-end px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 cursor-pointer"
              title="Enviar (Ctrl+Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            El mensaje se envía por WhatsApp al paciente.
          </p>
        </div>
      )}
    </div>
  );
}
