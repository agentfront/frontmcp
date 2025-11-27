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
  }
}

/**
 * Error thrown when connection fails
 */
export class ConnectionError extends TestClientError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ConnectionError';
  }
}

/**
 * Error thrown when request times out
 */
export class TimeoutError extends TestClientError {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Error thrown when MCP returns an error response
 */
export class McpProtocolError extends TestClientError {
  constructor(message: string, public readonly code: number, public readonly data?: unknown) {
    super(message);
    this.name = 'McpProtocolError';
  }
}

/**
 * Error thrown when server fails to start
 */
export class ServerStartError extends TestClientError {
  constructor(message: string, public readonly cause?: Error) {
    super(message);
    this.name = 'ServerStartError';
  }
}

/**
 * Error thrown when assertion fails
 */
export class AssertionError extends TestClientError {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}
