/**
 * Guard Error Classes
 *
 * Standalone error hierarchy — no dependency on SDK error classes.
 * Consumers (e.g., @frontmcp/sdk) can catch GuardError and re-throw
 * as protocol-specific errors if needed.
 */

/**
 * Base error class for all guard errors.
 * Carries a machine-readable code and HTTP status code.
 */
export class GuardError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when execution exceeds its configured timeout.
 */
export class ExecutionTimeoutError extends GuardError {
  readonly entityName: string;
  readonly timeoutMs: number;

  constructor(entityName: string, timeoutMs: number) {
    super(`Execution of "${entityName}" timed out after ${timeoutMs}ms`, 'EXECUTION_TIMEOUT', 408);
    this.entityName = entityName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a concurrency limit is reached.
 */
export class ConcurrencyLimitError extends GuardError {
  readonly entityName: string;
  readonly maxConcurrent: number;

  constructor(entityName: string, maxConcurrent: number) {
    super(`Concurrency limit reached for "${entityName}" (max: ${maxConcurrent})`, 'CONCURRENCY_LIMIT', 429);
    this.entityName = entityName;
    this.maxConcurrent = maxConcurrent;
  }
}

/**
 * Thrown when a request waited in the concurrency queue but timed out.
 */
export class QueueTimeoutError extends GuardError {
  readonly entityName: string;
  readonly queueTimeoutMs: number;

  constructor(entityName: string, queueTimeoutMs: number) {
    super(
      `Queue timeout for "${entityName}" after waiting ${queueTimeoutMs}ms for a concurrency slot`,
      'QUEUE_TIMEOUT',
      429,
    );
    this.entityName = entityName;
    this.queueTimeoutMs = queueTimeoutMs;
  }
}

/**
 * Thrown when a client IP is on the deny list.
 */
export class IpBlockedError extends GuardError {
  readonly clientIp: string;

  constructor(clientIp: string) {
    super(`IP address "${clientIp}" is blocked`, 'IP_BLOCKED', 403);
    this.clientIp = clientIp;
  }
}

/**
 * Thrown when a client IP is not on the allow list (when default action is deny).
 */
export class IpNotAllowedError extends GuardError {
  readonly clientIp: string;

  constructor(clientIp: string) {
    super(`IP address "${clientIp}" is not allowed`, 'IP_NOT_ALLOWED', 403);
    this.clientIp = clientIp;
  }
}
