import {
  ConcurrencyLimitError,
  ExecutionTimeoutError,
  GuardError,
  GuardStorageUnavailableError,
  IpBlockedError,
  IpNotAllowedError,
  QueueTimeoutError,
} from '../index';

describe('GuardError', () => {
  it('should set message, code, statusCode, and name', () => {
    const err = new GuardError('test message', 'TEST_CODE', 500);

    expect(err.message).toBe('test message');
    expect(err.code).toBe('TEST_CODE');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('GuardError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GuardError);
  });
});

describe('ExecutionTimeoutError', () => {
  it('should set all properties correctly', () => {
    const err = new ExecutionTimeoutError('my-tool', 5000);

    expect(err.message).toBe('Execution of "my-tool" timed out after 5000ms');
    expect(err.code).toBe('EXECUTION_TIMEOUT');
    expect(err.statusCode).toBe(408);
    expect(err.name).toBe('ExecutionTimeoutError');
    expect(err.entityName).toBe('my-tool');
    expect(err.timeoutMs).toBe(5000);
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(ExecutionTimeoutError);
  });
});

describe('ConcurrencyLimitError', () => {
  it('should set all properties correctly', () => {
    const err = new ConcurrencyLimitError('my-tool', 10);

    expect(err.message).toBe('Concurrency limit reached for "my-tool" (max: 10)');
    expect(err.code).toBe('CONCURRENCY_LIMIT');
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe('ConcurrencyLimitError');
    expect(err.entityName).toBe('my-tool');
    expect(err.maxConcurrent).toBe(10);
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(ConcurrencyLimitError);
  });
});

describe('QueueTimeoutError', () => {
  it('should set all properties correctly', () => {
    const err = new QueueTimeoutError('my-tool', 3000);

    expect(err.message).toBe('Queue timeout for "my-tool" after waiting 3000ms for a concurrency slot');
    expect(err.code).toBe('QUEUE_TIMEOUT');
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe('QueueTimeoutError');
    expect(err.entityName).toBe('my-tool');
    expect(err.queueTimeoutMs).toBe(3000);
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(QueueTimeoutError);
  });
});

describe('IpBlockedError', () => {
  it('should set all properties correctly', () => {
    const err = new IpBlockedError('192.168.1.100');

    expect(err.message).toBe('IP address "192.168.1.100" is blocked');
    expect(err.code).toBe('IP_BLOCKED');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('IpBlockedError');
    expect(err.clientIp).toBe('192.168.1.100');
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(IpBlockedError);
  });
});

describe('IpNotAllowedError', () => {
  it('should set all properties correctly', () => {
    const err = new IpNotAllowedError('10.0.0.1');

    expect(err.message).toBe('IP address "10.0.0.1" is not allowed');
    expect(err.code).toBe('IP_NOT_ALLOWED');
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('IpNotAllowedError');
    expect(err.clientIp).toBe('10.0.0.1');
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(IpNotAllowedError);
  });
});

describe('GuardStorageUnavailableError', () => {
  it('should set all properties correctly', () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:6379');
    const err = new GuardStorageUnavailableError('redis', cause);

    expect(err.message).toBe(
      'throttle.storage (redis) is unavailable: connect ECONNREFUSED 127.0.0.1:6379. Rate limits fail closed, ' +
        "so the server will not start without it. Set throttle.storage.fallback: 'memory' to start with " +
        'per-instance counters instead.',
    );
    expect(err.code).toBe('GUARD_STORAGE_UNAVAILABLE');
    expect(err.statusCode).toBe(503);
    expect(err.name).toBe('GuardStorageUnavailableError');
    expect(err.storageType).toBe('redis');
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(GuardError);
    expect(err).toBeInstanceOf(GuardStorageUnavailableError);
  });

  it('should describe a non-Error cause and a missing one', () => {
    expect(new GuardStorageUnavailableError('auto', 'timeout').message).toContain('unavailable: timeout.');
    expect(new GuardStorageUnavailableError('auto').message).toContain('unavailable: unknown error.');
  });
});
