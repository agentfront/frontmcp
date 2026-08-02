import { type TaskRecord } from '../../../task/task.types';
import { resolveTaskPrincipal } from '../dispatcher';
import {
  buildCreateTaskResult,
  clientSupportsTasks,
  resolveTaskOwner,
  TASKS_EXTENSION_ID,
  taskToWire20260728,
} from '../tasks-extension';

const base: TaskRecord = {
  taskId: 'task-1',
  sessionId: 'principal:user-1',
  status: 'working',
  createdAt: '2026-08-01T00:00:00.000Z',
  lastUpdatedAt: '2026-08-01T00:00:01.000Z',
  ttlMs: 60_000,
  pollIntervalMs: 50,
  expiresAt: Date.parse('2026-08-01T00:01:00.000Z'),
  request: { method: 'tools/call', params: { name: 'slow-job' } },
};

describe('clientSupportsTasks', () => {
  it('accepts a client declaring the extension', () => {
    expect(clientSupportsTasks({ extensions: { [TASKS_EXTENSION_ID]: {} } })).toBe(true);
  });

  it('rejects a client declaring no extensions', () => {
    expect(clientSupportsTasks({})).toBe(false);
    expect(clientSupportsTasks({ extensions: {} })).toBe(false);
  });

  it('rejects a client declaring a different extension', () => {
    expect(clientSupportsTasks({ extensions: { 'io.modelcontextprotocol/ui': {} } })).toBe(false);
  });

  it('ignores a malformed extensions value', () => {
    expect(clientSupportsTasks({ extensions: 'nope' })).toBe(false);
  });
});

describe('taskToWire20260728', () => {
  it('uses the 2026 field names', () => {
    const wire = taskToWire20260728(base);
    expect(wire['ttlMs']).toBe(60_000);
    expect(wire['pollIntervalMs']).toBe(50);
    // Renamed from the 2025-11-25 core protocol; leaking the old spelling would
    // make a conforming client miss the values entirely.
    expect(wire['ttl']).toBeUndefined();
    expect(wire['pollInterval']).toBeUndefined();
  });

  it('omits result and error while still working', () => {
    const wire = taskToWire20260728(base);
    expect(wire['result']).toBeUndefined();
    expect(wire['error']).toBeUndefined();
    expect(wire['inputRequests']).toBeUndefined();
  });

  it('carries the result once completed', () => {
    const wire = taskToWire20260728({
      ...base,
      status: 'completed',
      outcome: { kind: 'ok', data: { content: [{ type: 'text', text: 'done' }] } },
    });
    expect(wire['status']).toBe('completed');
    expect(JSON.stringify(wire['result'])).toContain('done');
  });

  it('carries the error once failed', () => {
    const wire = taskToWire20260728({
      ...base,
      status: 'failed',
      outcome: { kind: 'error', error: { code: -32603, message: 'boom' } },
    });
    expect(wire['error']).toEqual({ code: -32603, message: 'boom' });
  });

  it('carries inputRequests while awaiting input', () => {
    const wire = taskToWire20260728({
      ...base,
      status: 'input_required',
      inputRequests: { 'elicitation-1': { method: 'elicitation/create', params: { message: 'ok?' } } },
    });
    expect(wire['inputRequests']).toEqual({
      'elicitation-1': { method: 'elicitation/create', params: { message: 'ok?' } },
    });
  });

  it('does not leak a stale result on a cancelled task', () => {
    const wire = taskToWire20260728({
      ...base,
      status: 'cancelled',
      outcome: { kind: 'ok', data: { content: [] } },
    });
    expect(wire['result']).toBeUndefined();
  });

  it('omits optional fields that are unset', () => {
    const { pollIntervalMs: _drop, ...withoutPoll } = base;
    const wire = taskToWire20260728(withoutPoll as TaskRecord);
    expect('pollIntervalMs' in wire).toBe(false);
    expect('statusMessage' in wire).toBe(false);
  });
});

describe('buildCreateTaskResult', () => {
  it('discriminates the handle with resultType "task"', () => {
    const result = buildCreateTaskResult(base);
    expect(result['resultType']).toBe('task');
    expect((result['task'] as Record<string, unknown>)['taskId']).toBe('task-1');
  });
});

describe('resolveTaskOwner', () => {
  it('namespaces an identified principal', () => {
    expect(resolveTaskOwner('user-1')).toEqual({ ok: true, owner: 'principal:user-1' });
  });

  it('refuses an anonymous caller', () => {
    // Pooling anonymous callers would let them read each other's task results.
    const result = resolveTaskOwner('anonymous');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('authenticated caller');
  });

  it('refuses an empty principal', () => {
    expect(resolveTaskOwner('').ok).toBe(false);
  });
});

describe('resolveTaskPrincipal', () => {
  it('uses the verified subject', () => {
    expect(resolveTaskPrincipal({ clientId: 'user-9' })).toBe('user-9');
  });

  it('treats an anonymous session as anonymous even with a synthetic subject', () => {
    expect(resolveTaskPrincipal({ clientId: 'anon-abc' }, true)).toBe('anonymous');
  });

  it('never accepts the token fallback as a task owner', () => {
    // `resolvePrincipal` would return `tok:…` here; that is fine for binding a
    // short-lived requestState but must not own a durable task.
    expect(resolveTaskPrincipal({ token: 'abcdef0123456789' })).toBe('anonymous');
  });

  it('falls back to anonymous with no auth at all', () => {
    expect(resolveTaskPrincipal(undefined)).toBe('anonymous');
  });
});
