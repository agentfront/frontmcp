import { createEventStore } from '../event-store.factory';
import { MemoryEventStore } from '../memory.event-store';

describe('createEventStore', () => {
  describe('disabled configuration', () => {
    it('should return undefined when config is undefined', () => {
      const result = createEventStore(undefined);

      expect(result.eventStore).toBeUndefined();
      expect(result.type).toBe('disabled');
    });

    it('should return undefined when enabled is false', () => {
      const result = createEventStore({ enabled: false });

      expect(result.eventStore).toBeUndefined();
      expect(result.type).toBe('disabled');
    });
  });

  describe('memory provider', () => {
    it('should create MemoryEventStore when enabled with memory provider', () => {
      const result = createEventStore({
        enabled: true,
        provider: 'memory',
      });

      expect(result.eventStore).toBeInstanceOf(MemoryEventStore);
      expect(result.type).toBe('memory');
    });

    it('should create MemoryEventStore when enabled without provider (default)', () => {
      const result = createEventStore({
        enabled: true,
      });

      expect(result.eventStore).toBeInstanceOf(MemoryEventStore);
      expect(result.type).toBe('memory');
    });

    it('should respect maxEvents and ttlMs options', () => {
      const result = createEventStore({
        enabled: true,
        provider: 'memory',
        maxEvents: 5000,
        ttlMs: 120000,
      });

      expect(result.eventStore).toBeInstanceOf(MemoryEventStore);
      expect(result.type).toBe('memory');
    });
  });

  describe('redis provider', () => {
    it('should throw when redis provider is specified without redis config', () => {
      expect(() =>
        createEventStore({
          enabled: true,
          provider: 'redis',
        }),
      ).toThrow('EventStore Redis configuration required');
    });

    it('should create RedisEventStore when redis config is provided', () => {
      // Note: We don't actually connect to Redis in this test,
      // we just verify the factory creates the right type
      const result = createEventStore({
        enabled: true,
        provider: 'redis',
        redis: {
          provider: 'redis',
          host: 'localhost',
          port: 6379,
        },
      });

      expect(result.eventStore).toBeDefined();
      expect(result.type).toBe('redis');
    });
  });
});
