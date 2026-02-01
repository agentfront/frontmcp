/**
 * Skill Events Tests
 *
 * Tests for skill change events and emitter.
 */

import { SkillEmitter, SkillChangeEvent, SkillChangeKind, SkillChangeScope } from '../skill.events';

describe('skill.events', () => {
  describe('SkillEmitter', () => {
    let emitter: SkillEmitter;

    beforeEach(() => {
      emitter = new SkillEmitter();
    });

    afterEach(() => {
      emitter.clear();
    });

    it('should start with zero listeners', () => {
      expect(emitter.listenerCount).toBe(0);
    });

    it('should register listeners with on()', () => {
      const listener = jest.fn();
      emitter.on(listener);

      expect(emitter.listenerCount).toBe(1);
    });

    it('should return unsubscribe function from on()', () => {
      const listener = jest.fn();
      const unsubscribe = emitter.on(listener);

      expect(typeof unsubscribe).toBe('function');
      expect(emitter.listenerCount).toBe(1);

      unsubscribe();
      expect(emitter.listenerCount).toBe(0);
    });

    it('should emit events to all listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on(listener1);
      emitter.on(listener2);

      const event: SkillChangeEvent = {
        kind: 'added',
        changeScope: 'global',
        version: 1,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listener1).toHaveBeenCalledWith(event);
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should not call unsubscribed listeners', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const unsubscribe1 = emitter.on(listener1);
      emitter.on(listener2);

      unsubscribe1();

      const event: SkillChangeEvent = {
        kind: 'removed',
        changeScope: 'global',
        version: 2,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith(event);
    });

    it('should handle multiple subscriptions and unsubscriptions', () => {
      const listeners = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
      const unsubscribes = listeners.map((l) => emitter.on(l));

      expect(emitter.listenerCount).toBe(4);

      // Unsubscribe first and third
      unsubscribes[0]();
      unsubscribes[2]();

      expect(emitter.listenerCount).toBe(2);

      const event: SkillChangeEvent = {
        kind: 'updated',
        changeScope: 'global',
        version: 3,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listeners[0]).not.toHaveBeenCalled();
      expect(listeners[1]).toHaveBeenCalledWith(event);
      expect(listeners[2]).not.toHaveBeenCalled();
      expect(listeners[3]).toHaveBeenCalledWith(event);
    });

    it('should clear all listeners', () => {
      emitter.on(jest.fn());
      emitter.on(jest.fn());
      emitter.on(jest.fn());

      expect(emitter.listenerCount).toBe(3);

      emitter.clear();

      expect(emitter.listenerCount).toBe(0);
    });

    it('should not emit to listeners after clear()', () => {
      const listener = jest.fn();
      emitter.on(listener);
      emitter.clear();

      const event: SkillChangeEvent = {
        kind: 'reset',
        changeScope: 'global',
        version: 1,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listener).not.toHaveBeenCalled();
    });

    it('should emit events with session scope', () => {
      const listener = jest.fn();
      emitter.on(listener);

      const event: SkillChangeEvent = {
        kind: 'added',
        changeScope: 'session',
        sessionId: 'session-123',
        version: 1,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listener).toHaveBeenCalledWith(event);
      expect(listener.mock.calls[0][0].changeScope).toBe('session');
      expect(listener.mock.calls[0][0].sessionId).toBe('session-123');
    });

    it('should include relatedRequestId when provided', () => {
      const listener = jest.fn();
      emitter.on(listener);

      const event: SkillChangeEvent = {
        kind: 'updated',
        changeScope: 'global',
        relatedRequestId: 'request-abc',
        version: 5,
        snapshot: [],
      };

      emitter.emit(event);

      expect(listener.mock.calls[0][0].relatedRequestId).toBe('request-abc');
    });

    it('should handle all event kinds', () => {
      const listener = jest.fn();
      emitter.on(listener);

      const kinds: SkillChangeKind[] = ['added', 'updated', 'removed', 'reset'];

      kinds.forEach((kind, index) => {
        const event: SkillChangeEvent = {
          kind,
          changeScope: 'global',
          version: index + 1,
          snapshot: [],
        };

        emitter.emit(event);
      });

      expect(listener).toHaveBeenCalledTimes(4);
      expect(listener.mock.calls[0][0].kind).toBe('added');
      expect(listener.mock.calls[1][0].kind).toBe('updated');
      expect(listener.mock.calls[2][0].kind).toBe('removed');
      expect(listener.mock.calls[3][0].kind).toBe('reset');
    });

    it('should handle all change scopes', () => {
      const listener = jest.fn();
      emitter.on(listener);

      const scopes: SkillChangeScope[] = ['global', 'session'];

      scopes.forEach((scope, index) => {
        const event: SkillChangeEvent = {
          kind: 'added',
          changeScope: scope,
          version: index + 1,
          snapshot: [],
        };

        emitter.emit(event);
      });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[0][0].changeScope).toBe('global');
      expect(listener.mock.calls[1][0].changeScope).toBe('session');
    });

    it('should be safe to unsubscribe multiple times', () => {
      const listener = jest.fn();
      const unsubscribe = emitter.on(listener);

      unsubscribe();
      expect(emitter.listenerCount).toBe(0);

      // Second call should not throw
      expect(() => unsubscribe()).not.toThrow();
      expect(emitter.listenerCount).toBe(0);
    });

    it('should iterate over copy of listeners during emit', () => {
      // This tests that listeners can safely unsubscribe during emit
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const callbacks: { unsubscribe2?: () => void } = {};

      const unsubscribe1 = emitter.on(() => {
        listener1();
        // Unsubscribe listener2 during listener1's callback
        callbacks.unsubscribe2?.();
      });

      callbacks.unsubscribe2 = emitter.on(listener2);

      const event: SkillChangeEvent = {
        kind: 'added',
        changeScope: 'global',
        version: 1,
        snapshot: [],
      };

      emitter.emit(event);

      // Both should have been called since we iterate over a copy
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      // But listener2 should be unsubscribed now
      expect(emitter.listenerCount).toBe(1);
    });
  });
});
