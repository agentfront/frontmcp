import * as guard from '../index';

describe('@frontmcp/guard barrel exports', () => {
  describe('errors', () => {
    it('should export GuardError', () => {
      expect(guard.GuardError).toBeDefined();
    });

    it('should export ExecutionTimeoutError', () => {
      expect(guard.ExecutionTimeoutError).toBeDefined();
    });

    it('should export ConcurrencyLimitError', () => {
      expect(guard.ConcurrencyLimitError).toBeDefined();
    });

    it('should export QueueTimeoutError', () => {
      expect(guard.QueueTimeoutError).toBeDefined();
    });

    it('should export IpBlockedError', () => {
      expect(guard.IpBlockedError).toBeDefined();
    });

    it('should export IpNotAllowedError', () => {
      expect(guard.IpNotAllowedError).toBeDefined();
    });
  });

  describe('schemas', () => {
    it('should export partitionKeySchema', () => {
      expect(guard.partitionKeySchema).toBeDefined();
    });

    it('should export rateLimitConfigSchema', () => {
      expect(guard.rateLimitConfigSchema).toBeDefined();
    });

    it('should export concurrencyConfigSchema', () => {
      expect(guard.concurrencyConfigSchema).toBeDefined();
    });

    it('should export timeoutConfigSchema', () => {
      expect(guard.timeoutConfigSchema).toBeDefined();
    });

    it('should export ipFilterConfigSchema', () => {
      expect(guard.ipFilterConfigSchema).toBeDefined();
    });

    it('should export guardConfigSchema', () => {
      expect(guard.guardConfigSchema).toBeDefined();
    });
  });

  describe('partition-key', () => {
    it('should export resolvePartitionKey', () => {
      expect(guard.resolvePartitionKey).toBeDefined();
    });

    it('should export buildStorageKey', () => {
      expect(guard.buildStorageKey).toBeDefined();
    });
  });

  describe('rate-limit', () => {
    it('should export SlidingWindowRateLimiter', () => {
      expect(guard.SlidingWindowRateLimiter).toBeDefined();
    });
  });

  describe('concurrency', () => {
    it('should export DistributedSemaphore', () => {
      expect(guard.DistributedSemaphore).toBeDefined();
    });
  });

  describe('timeout', () => {
    it('should export withTimeout', () => {
      expect(guard.withTimeout).toBeDefined();
    });
  });

  describe('ip-filter', () => {
    it('should export IpFilter', () => {
      expect(guard.IpFilter).toBeDefined();
    });
  });

  describe('manager', () => {
    it('should export GuardManager', () => {
      expect(guard.GuardManager).toBeDefined();
    });

    it('should export createGuardManager', () => {
      expect(guard.createGuardManager).toBeDefined();
    });
  });
});
