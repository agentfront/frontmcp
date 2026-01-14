/**
 * Storage Error Classes Tests
 */
import {
  StorageError,
  StorageConnectionError,
  StorageOperationError,
  StorageNotSupportedError,
  StorageConfigError,
  StorageTTLError,
  StoragePatternError,
  StorageNotConnectedError,
} from '../errors';

describe('Storage Error Classes', () => {
  describe('StorageError (base class)', () => {
    it('should create error with message', () => {
      const error = new StorageError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('StorageError');
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new StorageError('Wrapped error', cause);
      expect(error.cause).toBe(cause);
    });

    it('should be instanceof Error', () => {
      const error = new StorageError('Test');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(StorageError);
    });

    it('should have stack trace', () => {
      const error = new StorageError('Test');
      expect(error.stack).toBeDefined();
    });
  });

  describe('StorageConnectionError', () => {
    it('should create error with message', () => {
      const error = new StorageConnectionError('Connection failed');
      expect(error.message).toBe('Connection failed');
      expect(error.name).toBe('StorageConnectionError');
    });

    it('should include backend name', () => {
      const error = new StorageConnectionError('Connection failed', undefined, 'redis');
      expect(error.backend).toBe('redis');
    });

    it('should include cause', () => {
      const cause = new Error('ECONNREFUSED');
      const error = new StorageConnectionError('Connection failed', cause, 'redis');
      expect(error.cause).toBe(cause);
    });

    it('should include cause message in error message', () => {
      const cause = new Error('ECONNREFUSED 127.0.0.1:6379');
      const error = new StorageConnectionError('Failed to connect to Redis', cause, 'redis');

      expect(error.message).toBe('Failed to connect to Redis: ECONNREFUSED 127.0.0.1:6379');
      expect(error.cause).toBe(cause);
    });

    it('should work without cause (message unchanged)', () => {
      const error = new StorageConnectionError('Connection failed', undefined, 'redis');

      expect(error.message).toBe('Connection failed');
      expect(error.cause).toBeUndefined();
    });

    it('should extend StorageError', () => {
      const error = new StorageConnectionError('Test');
      expect(error).toBeInstanceOf(StorageError);
    });
  });

  describe('StorageOperationError', () => {
    it('should create error with operation and key', () => {
      const error = new StorageOperationError('set', 'user:123', 'Value too large');
      expect(error.operation).toBe('set');
      expect(error.key).toBe('user:123');
      expect(error.message).toContain('set');
      expect(error.message).toContain('user:123');
      expect(error.message).toContain('Value too large');
    });

    it('should format message correctly', () => {
      const error = new StorageOperationError('get', 'key:test', 'Timeout');
      expect(error.message).toBe('get failed for key "key:test": Timeout');
    });

    it('should include cause', () => {
      const cause = new Error('Network error');
      const error = new StorageOperationError('set', 'key', 'Failed', cause);
      expect(error.cause).toBe(cause);
    });

    it('should have name StorageOperationError', () => {
      const error = new StorageOperationError('get', 'key', 'Error');
      expect(error.name).toBe('StorageOperationError');
    });

    it('should extend StorageError', () => {
      const error = new StorageOperationError('get', 'key', 'Error');
      expect(error).toBeInstanceOf(StorageError);
    });
  });

  describe('StorageNotSupportedError', () => {
    it('should create error with operation and backend', () => {
      const error = new StorageNotSupportedError('publish', 'vercel-kv');
      expect(error.operation).toBe('publish');
      expect(error.backend).toBe('vercel-kv');
      expect(error.message).toContain('publish');
      expect(error.message).toContain('vercel-kv');
    });

    it('should include suggestion when provided', () => {
      const error = new StorageNotSupportedError('publish', 'vercel-kv', 'Use Upstash instead.');
      expect(error.message).toContain('Use Upstash instead.');
    });

    it('should format message without suggestion', () => {
      const error = new StorageNotSupportedError('subscribe', 'memory');
      expect(error.message).toBe('subscribe is not supported by memory');
    });

    it('should format message with suggestion', () => {
      const error = new StorageNotSupportedError('subscribe', 'vercel-kv', 'Use Upstash for pub/sub.');
      expect(error.message).toBe('subscribe is not supported by vercel-kv. Use Upstash for pub/sub.');
    });

    it('should have name StorageNotSupportedError', () => {
      const error = new StorageNotSupportedError('op', 'backend');
      expect(error.name).toBe('StorageNotSupportedError');
    });
  });

  describe('StorageConfigError', () => {
    it('should create error with backend and message', () => {
      const error = new StorageConfigError('redis', 'URL is required');
      expect(error.backend).toBe('redis');
      expect(error.message).toContain('redis');
      expect(error.message).toContain('URL is required');
    });

    it('should format message correctly', () => {
      const error = new StorageConfigError('upstash', 'Token missing');
      expect(error.message).toBe('Invalid upstash configuration: Token missing');
    });

    it('should have name StorageConfigError', () => {
      const error = new StorageConfigError('redis', 'Error');
      expect(error.name).toBe('StorageConfigError');
    });
  });

  describe('StorageTTLError', () => {
    it('should create error with TTL value', () => {
      const error = new StorageTTLError(-1);
      expect(error.ttl).toBe(-1);
      expect(error.message).toContain('-1');
    });

    it('should use custom message when provided', () => {
      const error = new StorageTTLError(0, 'TTL must be positive');
      expect(error.message).toBe('TTL must be positive');
    });

    it('should use default message when not provided', () => {
      const error = new StorageTTLError(1.5);
      expect(error.message).toContain('Invalid TTL value: 1.5');
      expect(error.message).toContain('positive integer');
    });

    it('should have name StorageTTLError', () => {
      const error = new StorageTTLError(0);
      expect(error.name).toBe('StorageTTLError');
    });
  });

  describe('StoragePatternError', () => {
    it('should create error with pattern and message', () => {
      const error = new StoragePatternError('***', 'Too many wildcards');
      expect(error.pattern).toBe('***');
      expect(error.message).toContain('***');
      expect(error.message).toContain('Too many wildcards');
    });

    it('should format message correctly', () => {
      const error = new StoragePatternError('bad*pattern', 'Invalid syntax');
      expect(error.message).toBe('Invalid pattern "bad*pattern": Invalid syntax');
    });

    it('should have name StoragePatternError', () => {
      const error = new StoragePatternError('*', 'Error');
      expect(error.name).toBe('StoragePatternError');
    });
  });

  describe('StorageNotConnectedError', () => {
    it('should create error with backend name', () => {
      const error = new StorageNotConnectedError('redis');
      expect(error.backend).toBe('redis');
      expect(error.message).toContain('redis');
      expect(error.message).toContain('not connected');
    });

    it('should format message correctly', () => {
      const error = new StorageNotConnectedError('memory');
      expect(error.message).toBe('Storage backend "memory" is not connected. Call connect() first.');
    });

    it('should have name StorageNotConnectedError', () => {
      const error = new StorageNotConnectedError('test');
      expect(error.name).toBe('StorageNotConnectedError');
    });
  });

  describe('Error hierarchy', () => {
    it('all errors should extend StorageError', () => {
      expect(new StorageConnectionError('Test')).toBeInstanceOf(StorageError);
      expect(new StorageOperationError('op', 'key', 'msg')).toBeInstanceOf(StorageError);
      expect(new StorageNotSupportedError('op', 'backend')).toBeInstanceOf(StorageError);
      expect(new StorageConfigError('backend', 'msg')).toBeInstanceOf(StorageError);
      expect(new StorageTTLError(0)).toBeInstanceOf(StorageError);
      expect(new StoragePatternError('*', 'msg')).toBeInstanceOf(StorageError);
      expect(new StorageNotConnectedError('backend')).toBeInstanceOf(StorageError);
    });

    it('all errors should be catchable as Error', () => {
      const errors = [
        new StorageError('Test'),
        new StorageConnectionError('Test'),
        new StorageOperationError('op', 'key', 'msg'),
        new StorageNotSupportedError('op', 'backend'),
        new StorageConfigError('backend', 'msg'),
        new StorageTTLError(0),
        new StoragePatternError('*', 'msg'),
        new StorageNotConnectedError('backend'),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should allow catching specific error types', () => {
      const error: Error = new StorageConnectionError('Test');

      // Should be catchable as specific type
      if (error instanceof StorageConnectionError) {
        expect(error.backend).toBeUndefined();
      } else {
        fail('Should be instanceof StorageConnectionError');
      }
    });
  });
});
