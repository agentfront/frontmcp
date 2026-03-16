import { resolvePartitionKey, buildStorageKey } from '../index';
import type { PartitionKeyContext } from '../index';

describe('resolvePartitionKey', () => {
  const fullContext: PartitionKeyContext = {
    sessionId: 'sess-123',
    clientIp: '10.0.0.1',
    userId: 'user-456',
  };

  describe('undefined / global', () => {
    it('should return "global" when partitionBy is undefined', () => {
      expect(resolvePartitionKey(undefined, fullContext)).toBe('global');
    });

    it('should return "global" when partitionBy is "global"', () => {
      expect(resolvePartitionKey('global', fullContext)).toBe('global');
    });

    it('should return "global" when both partitionBy and context are undefined', () => {
      expect(resolvePartitionKey(undefined, undefined)).toBe('global');
    });
  });

  describe('ip strategy', () => {
    it('should return clientIp when available', () => {
      expect(resolvePartitionKey('ip', fullContext)).toBe('10.0.0.1');
    });

    it('should return "unknown-ip" when clientIp is missing', () => {
      expect(resolvePartitionKey('ip', { sessionId: 'sess-1' })).toBe('unknown-ip');
    });

    it('should return "unknown-ip" when context is undefined', () => {
      expect(resolvePartitionKey('ip', undefined)).toBe('unknown-ip');
    });
  });

  describe('session strategy', () => {
    it('should return sessionId', () => {
      expect(resolvePartitionKey('session', fullContext)).toBe('sess-123');
    });

    it('should return "anonymous" when context is undefined', () => {
      expect(resolvePartitionKey('session', undefined)).toBe('anonymous');
    });
  });

  describe('userId strategy', () => {
    it('should return userId when available', () => {
      expect(resolvePartitionKey('userId', fullContext)).toBe('user-456');
    });

    it('should fallback to sessionId when userId is missing', () => {
      expect(resolvePartitionKey('userId', { sessionId: 'sess-1' })).toBe('sess-1');
    });

    it('should return "anonymous" when context is undefined', () => {
      expect(resolvePartitionKey('userId', undefined)).toBe('anonymous');
    });
  });

  describe('custom function', () => {
    it('should call the custom function with context', () => {
      const customFn = jest.fn().mockReturnValue('custom-key');
      const result = resolvePartitionKey(customFn, fullContext);

      expect(result).toBe('custom-key');
      expect(customFn).toHaveBeenCalledWith(fullContext);
    });

    it('should provide default context when context is undefined', () => {
      const customFn = jest.fn().mockReturnValue('fallback');
      resolvePartitionKey(customFn, undefined);

      expect(customFn).toHaveBeenCalledWith({ sessionId: 'anonymous' });
    });
  });

  describe('default case (unknown strategy)', () => {
    it('should return "global" for an unknown partition strategy', () => {
      // Cast to bypass TypeScript exhaustiveness check for coverage of the default branch
      const unknownStrategy = 'unknown-strategy' as unknown as 'ip';
      const result = resolvePartitionKey(unknownStrategy, fullContext);
      expect(result).toBe('global');
    });
  });
});

describe('buildStorageKey', () => {
  it('should join entity name and partition key', () => {
    expect(buildStorageKey('my-tool', 'user-123')).toBe('my-tool:user-123');
  });

  it('should append suffix when provided', () => {
    expect(buildStorageKey('my-tool', 'user-123', 'rl')).toBe('my-tool:user-123:rl');
  });

  it('should handle global partition key', () => {
    expect(buildStorageKey('my-tool', 'global', 'sem')).toBe('my-tool:global:sem');
  });
});
