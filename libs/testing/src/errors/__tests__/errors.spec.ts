import {
  TestClientError,
  ConnectionError,
  TimeoutError,
  McpProtocolError,
  ServerStartError,
  AssertionError,
} from '../index';

describe('TestClientError', () => {
  it('should set message and name', () => {
    const err = new TestClientError('something failed');
    expect(err.message).toBe('something failed');
    expect(err.name).toBe('TestClientError');
  });

  it('should be instanceof Error', () => {
    const err = new TestClientError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
  });

  it('should have correct prototype chain', () => {
    const err = new TestClientError('msg');
    expect(Object.getPrototypeOf(err)).toBe(TestClientError.prototype);
  });
});

describe('ConnectionError', () => {
  it('should set message, name, and cause', () => {
    const cause = new Error('network down');
    const err = new ConnectionError('connection failed', cause);
    expect(err.message).toBe('connection failed');
    expect(err.name).toBe('ConnectionError');
    expect(err.cause).toBe(cause);
  });

  it('should allow undefined cause', () => {
    const err = new ConnectionError('connection failed');
    expect(err.cause).toBeUndefined();
  });

  it('should be instanceof TestClientError and Error', () => {
    const err = new ConnectionError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
    expect(err).toBeInstanceOf(ConnectionError);
  });

  it('should have correct prototype chain', () => {
    const err = new ConnectionError('msg');
    expect(Object.getPrototypeOf(err)).toBe(ConnectionError.prototype);
  });
});

describe('TimeoutError', () => {
  it('should set message, name, and timeoutMs', () => {
    const err = new TimeoutError('timed out', 5000);
    expect(err.message).toBe('timed out');
    expect(err.name).toBe('TimeoutError');
    expect(err.timeoutMs).toBe(5000);
  });

  it('should be instanceof TestClientError and Error', () => {
    const err = new TimeoutError('msg', 1000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
    expect(err).toBeInstanceOf(TimeoutError);
  });

  it('should have correct prototype chain', () => {
    const err = new TimeoutError('msg', 100);
    expect(Object.getPrototypeOf(err)).toBe(TimeoutError.prototype);
  });
});

describe('McpProtocolError', () => {
  it('should set message, name, code, and data', () => {
    const err = new McpProtocolError('bad request', -32600, { details: 'foo' });
    expect(err.message).toBe('bad request');
    expect(err.name).toBe('McpProtocolError');
    expect(err.code).toBe(-32600);
    expect(err.data).toEqual({ details: 'foo' });
  });

  it('should allow undefined data', () => {
    const err = new McpProtocolError('internal', -32603);
    expect(err.data).toBeUndefined();
  });

  it('should be instanceof TestClientError and Error', () => {
    const err = new McpProtocolError('msg', -32600);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
    expect(err).toBeInstanceOf(McpProtocolError);
  });

  it('should have correct prototype chain', () => {
    const err = new McpProtocolError('msg', -32600);
    expect(Object.getPrototypeOf(err)).toBe(McpProtocolError.prototype);
  });
});

describe('ServerStartError', () => {
  it('should set message, name, and cause', () => {
    const cause = new Error('port in use');
    const err = new ServerStartError('failed to start', cause);
    expect(err.message).toBe('failed to start');
    expect(err.name).toBe('ServerStartError');
    expect(err.cause).toBe(cause);
  });

  it('should allow undefined cause', () => {
    const err = new ServerStartError('failed');
    expect(err.cause).toBeUndefined();
  });

  it('should be instanceof TestClientError and Error', () => {
    const err = new ServerStartError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
    expect(err).toBeInstanceOf(ServerStartError);
  });

  it('should have correct prototype chain', () => {
    const err = new ServerStartError('msg');
    expect(Object.getPrototypeOf(err)).toBe(ServerStartError.prototype);
  });
});

describe('AssertionError', () => {
  it('should set message and name', () => {
    const err = new AssertionError('assertion failed');
    expect(err.message).toBe('assertion failed');
    expect(err.name).toBe('AssertionError');
  });

  it('should be instanceof TestClientError and Error', () => {
    const err = new AssertionError('msg');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(TestClientError);
    expect(err).toBeInstanceOf(AssertionError);
  });

  it('should have correct prototype chain', () => {
    const err = new AssertionError('msg');
    expect(Object.getPrototypeOf(err)).toBe(AssertionError.prototype);
  });
});
