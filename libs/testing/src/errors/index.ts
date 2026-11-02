/**
 * @file errors/index.ts
 * @description Error classes for @frontmcp/testing
 */

/**
 * Base error class for test client errors
 */
export class TestClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestClientError';
    // Fix prototype chain for proper instanceof checks in transpiled code
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when connection fails
 */
export class ConnectionError extends TestClientError {
  constructor(
    message: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ConnectionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when request times out
 */
export class TimeoutError extends TestClientError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when MCP returns an error response
 */
export class McpProtocolError extends TestClientError {
  constructor(
    message: string,
    public readonly code: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'McpProtocolError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when server fails to start
 */
export class ServerStartError extends TestClientError {
  constructor(
    message: string,
    public override readonly cause?: Error,
  ) {
    super(message);
    this.name = 'ServerStartError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when assertion fails
 */
export class AssertionError extends TestClientError {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a call recording has a line that is not a call record
 */
export class ReplayRecordingError extends TestClientError {
  constructor(
    public readonly file: string,
    public readonly line: number,
    reason: string,
  ) {
    super(`${file} line ${line} is not a call record: ${reason}`);
    this.name = 'ReplayRecordingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
