import { EventEmitter } from '../browser-event-emitter';

describe('Browser EventEmitter polyfill', () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe('on/emit', () => {
    it('should call listener when event is emitted', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      emitter.emit('test', 'arg1', 'arg2');
      expect(listener).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should call multiple listeners in order', () => {
      const order: number[] = [];
      emitter.on('test', () => order.push(1));
      emitter.on('test', () => order.push(2));
      emitter.emit('test');
      expect(order).toEqual([1, 2]);
    });

    it('should return false when no listeners exist', () => {
      expect(emitter.emit('test')).toBe(false);
    });

    it('should return true when listeners exist', () => {
      emitter.on('test', () => {});
      expect(emitter.emit('test')).toBe(true);
    });

    it('should not call listeners for different events', () => {
      const listener = jest.fn();
      emitter.on('foo', listener);
      emitter.emit('bar');
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('addListener', () => {
    it('should be an alias for on', () => {
      const listener = jest.fn();
      emitter.addListener('test', listener);
      emitter.emit('test');
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('off/removeListener', () => {
    it('should remove a specific listener', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      emitter.off('test', listener);
      emitter.emit('test');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should only remove the specified listener', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.off('test', listener1);
      emitter.emit('test');
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('removeListener should be an alias for off', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      emitter.removeListener('test', listener);
      emitter.emit('test');
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle removing non-existent listener gracefully', () => {
      expect(() => {
        emitter.off('test', jest.fn());
      }).not.toThrow();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.removeAllListeners('test');
      emitter.emit('test');
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should remove all listeners when no event specified', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      emitter.on('foo', listener1);
      emitter.on('bar', listener2);
      emitter.removeAllListeners();
      emitter.emit('foo');
      emitter.emit('bar');
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount', () => {
    it('should return 0 for no listeners', () => {
      expect(emitter.listenerCount('test')).toBe(0);
    });

    it('should return correct count', () => {
      emitter.on('test', () => {});
      emitter.on('test', () => {});
      expect(emitter.listenerCount('test')).toBe(2);
    });

    it('should update after removal', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      expect(emitter.listenerCount('test')).toBe(1);
      emitter.off('test', listener);
      expect(emitter.listenerCount('test')).toBe(0);
    });
  });

  describe('setMaxListeners', () => {
    it('should be a no-op that returns the emitter', () => {
      const result = emitter.setMaxListeners(100);
      expect(result).toBe(emitter);
    });
  });

  describe('symbol events', () => {
    it('should support symbol event names', () => {
      const event = Symbol('test');
      const listener = jest.fn();
      emitter.on(event, listener);
      emitter.emit(event, 'data');
      expect(listener).toHaveBeenCalledWith('data');
    });
  });
});
