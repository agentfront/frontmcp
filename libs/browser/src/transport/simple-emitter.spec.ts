// file: libs/browser/src/transport/simple-emitter.spec.ts
import { SimpleEmitter, createSimpleEmitter } from './simple-emitter';

describe('SimpleEmitter', () => {
  let emitter: SimpleEmitter;

  beforeEach(() => {
    emitter = createSimpleEmitter();
  });

  describe('on/emit', () => {
    it('should register and call listeners', () => {
      const listener = jest.fn();
      emitter.on('test', listener);
      emitter.emit('test', 'arg1', 'arg2');

      expect(listener).toHaveBeenCalledWith('arg1', 'arg2');
    });

    it('should call multiple listeners for same event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.emit('test', 'data');

      expect(listener1).toHaveBeenCalledWith('data');
      expect(listener2).toHaveBeenCalledWith('data');
    });

    it('should return true when listeners exist', () => {
      emitter.on('test', jest.fn());
      expect(emitter.emit('test')).toBe(true);
    });

    it('should return false when no listeners exist', () => {
      expect(emitter.emit('test')).toBe(false);
    });

    it('should emit error event when listener throws', () => {
      const errorHandler = jest.fn();
      emitter.on('error', errorHandler);
      emitter.on('test', () => {
        throw new Error('test error');
      });

      emitter.emit('test');

      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should be chainable', () => {
      const result = emitter.on('test', jest.fn());
      expect(result).toBe(emitter);
    });
  });

  describe('off', () => {
    it('should remove a specific listener', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.off('test', listener1);
      emitter.emit('test');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('should handle removing non-existent listener', () => {
      const listener = jest.fn();
      expect(() => emitter.off('test', listener)).not.toThrow();
    });

    it('should be chainable', () => {
      const result = emitter.off('test', jest.fn());
      expect(result).toBe(emitter);
    });
  });

  describe('once', () => {
    it('should call listener only once', () => {
      const listener = jest.fn();
      emitter.once('test', listener);

      emitter.emit('test', 'first');
      emitter.emit('test', 'second');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('first');
    });

    it('should be chainable', () => {
      const result = emitter.once('test', jest.fn());
      expect(result).toBe(emitter);
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners for a specific event', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const otherListener = jest.fn();

      emitter.on('test', listener1);
      emitter.on('test', listener2);
      emitter.on('other', otherListener);

      emitter.removeAllListeners('test');

      emitter.emit('test');
      emitter.emit('other');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(otherListener).toHaveBeenCalled();
    });

    it('should remove all listeners when no event specified', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on('test1', listener1);
      emitter.on('test2', listener2);

      emitter.removeAllListeners();

      emitter.emit('test1');
      emitter.emit('test2');

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it('should be chainable', () => {
      const result = emitter.removeAllListeners();
      expect(result).toBe(emitter);
    });
  });

  describe('listenerCount', () => {
    it('should return 0 for event with no listeners', () => {
      expect(emitter.listenerCount('test')).toBe(0);
    });

    it('should return correct count', () => {
      emitter.on('test', jest.fn());
      emitter.on('test', jest.fn());
      expect(emitter.listenerCount('test')).toBe(2);
    });
  });

  describe('eventNames', () => {
    it('should return empty array when no listeners', () => {
      expect(emitter.eventNames()).toEqual([]);
    });

    it('should return all event names with listeners', () => {
      emitter.on('event1', jest.fn());
      emitter.on('event2', jest.fn());
      expect(emitter.eventNames()).toEqual(['event1', 'event2']);
    });
  });

  describe('createSimpleEmitter', () => {
    it('should create a new SimpleEmitter instance', () => {
      const emitter = createSimpleEmitter();
      expect(emitter).toBeInstanceOf(SimpleEmitter);
    });
  });
});
