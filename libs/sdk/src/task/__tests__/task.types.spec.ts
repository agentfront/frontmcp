import { isTerminal, toWireShape, type TaskRecord } from '../task.types';

describe('task.types', () => {
  describe('toWireShape', () => {
    it('projects only the protocol-visible fields', () => {
      const now = new Date().toISOString();
      const record: TaskRecord = {
        taskId: 't-1',
        sessionId: 'session-secret',
        status: 'working',
        statusMessage: 'hello',
        createdAt: now,
        lastUpdatedAt: now,
        ttlMs: 5000,
        pollIntervalMs: 1000,
        expiresAt: Date.now() + 5000,
        request: { method: 'tools/call', params: { name: 'x' } },
      };
      const wire = toWireShape(record);
      expect(wire).toEqual({
        taskId: 't-1',
        status: 'working',
        ttl: 5000,
        createdAt: now,
        lastUpdatedAt: now,
        pollInterval: 1000,
        statusMessage: 'hello',
      });
      // sessionId and other private fields must not leak.
      expect(wire).not.toHaveProperty('sessionId');
      expect(wire).not.toHaveProperty('request');
      expect(wire).not.toHaveProperty('expiresAt');
    });

    it('omits optional fields when not set', () => {
      const now = new Date().toISOString();
      const record: TaskRecord = {
        taskId: 't-2',
        sessionId: 's',
        status: 'completed',
        createdAt: now,
        lastUpdatedAt: now,
        ttlMs: null,
        expiresAt: Date.now() + 10_000,
        request: { method: 'tools/call', params: {} },
      };
      const wire = toWireShape(record);
      expect(wire.ttl).toBeNull();
      expect(wire).not.toHaveProperty('pollInterval');
      expect(wire).not.toHaveProperty('statusMessage');
    });
  });

  describe('isTerminal', () => {
    it('returns true for completed/failed/cancelled', () => {
      expect(isTerminal('completed')).toBe(true);
      expect(isTerminal('failed')).toBe(true);
      expect(isTerminal('cancelled')).toBe(true);
    });
    it('returns false for working/input_required', () => {
      expect(isTerminal('working')).toBe(false);
      expect(isTerminal('input_required')).toBe(false);
    });
  });
});
