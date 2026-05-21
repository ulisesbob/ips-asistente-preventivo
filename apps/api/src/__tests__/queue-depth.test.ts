import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── T9 — queue/queue-depth.ts ────────────────────────────────────────────────
// getQueueDepth(boss): consulta pgboss.job agrupado por (name, state) y devuelve
// un mapa { [queueName]: { [state]: count } }. Lo usa /health/cron cuando
// QUEUE_ENABLED. Usa boss.getDb().executeSql() (tipado en pg-boss).

const mockExecuteSql = vi.fn();

function makeFakeBoss() {
  return {
    getDb: () => ({ executeSql: mockExecuteSql }),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getQueueDepth', () => {
  it('agrupa por cola y estado', async () => {
    mockExecuteSql.mockResolvedValue({
      rows: [
        { name: 'reminders:followup', state: 'created', count: '12' },
        { name: 'reminders:followup', state: 'active', count: '3' },
        { name: 'reminders:followup', state: 'failed', count: '1' },
        { name: 'reminders:dead', state: 'completed', count: '2' },
      ],
    });

    const { getQueueDepth } = await import('../queue/queue-depth');
    const depth = await getQueueDepth(makeFakeBoss());

    expect(depth['reminders:followup']).toEqual({ created: 12, active: 3, failed: 1 });
    expect(depth['reminders:dead']).toEqual({ completed: 2 });
  });

  it('devuelve objeto vacío cuando no hay jobs', async () => {
    mockExecuteSql.mockResolvedValue({ rows: [] });

    const { getQueueDepth } = await import('../queue/queue-depth');
    const depth = await getQueueDepth(makeFakeBoss());

    expect(depth).toEqual({});
  });

  it('consulta el schema pgboss.job agrupando por name+state', async () => {
    mockExecuteSql.mockResolvedValue({ rows: [] });

    const { getQueueDepth } = await import('../queue/queue-depth');
    await getQueueDepth(makeFakeBoss());

    expect(mockExecuteSql).toHaveBeenCalledTimes(1);
    const sql = String(mockExecuteSql.mock.calls[0][0]).toLowerCase();
    expect(sql).toContain('pgboss.job');
    expect(sql).toContain('group by');
    expect(sql).toContain('state');
  });
});
