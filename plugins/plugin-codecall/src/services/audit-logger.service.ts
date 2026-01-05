// file: libs/plugins/src/codecall/services/audit-logger.service.ts

import { Provider, ProviderScope } from '@frontmcp/sdk';

/**
 * Audit event types for CodeCall operations.
 */
export const AUDIT_EVENT_TYPES = {
  /** Script execution started */
  EXECUTION_START: 'codecall:execution:start',
  /** Script execution completed successfully */
  EXECUTION_SUCCESS: 'codecall:execution:success',
  /** Script execution failed */
  EXECUTION_FAILURE: 'codecall:execution:failure',
  /** Script execution timed out */
  EXECUTION_TIMEOUT: 'codecall:execution:timeout',

  /** Tool call initiated from script */
  TOOL_CALL_START: 'codecall:tool:call:start',
  /** Tool call completed successfully */
  TOOL_CALL_SUCCESS: 'codecall:tool:call:success',
  /** Tool call failed */
  TOOL_CALL_FAILURE: 'codecall:tool:call:failure',

  /** Self-reference attack blocked */
  SECURITY_SELF_REFERENCE: 'codecall:security:self-reference',
  /** Tool access denied */
  SECURITY_ACCESS_DENIED: 'codecall:security:access-denied',
  /** AST validation failed (blocked code pattern) */
  SECURITY_AST_BLOCKED: 'codecall:security:ast-blocked',

  /** Search performed */
  SEARCH_PERFORMED: 'codecall:search:performed',
  /** Tool described */
  DESCRIBE_PERFORMED: 'codecall:describe:performed',
  /** Direct invoke performed */
  INVOKE_PERFORMED: 'codecall:invoke:performed',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

/**
 * Base audit event structure.
 */
export interface AuditEvent {
  /** Event type */
  type: AuditEventType;
  /** ISO timestamp */
  timestamp: string;
  /** Unique execution ID for correlation */
  executionId: string;
  /** Duration in milliseconds (if applicable) */
  durationMs?: number;
  /** Additional event-specific data */
  data?: Record<string, unknown>;
}

/**
 * Execution audit event with script details.
 */
export interface ExecutionAuditEvent extends AuditEvent {
  type:
    | typeof AUDIT_EVENT_TYPES.EXECUTION_START
    | typeof AUDIT_EVENT_TYPES.EXECUTION_SUCCESS
    | typeof AUDIT_EVENT_TYPES.EXECUTION_FAILURE
    | typeof AUDIT_EVENT_TYPES.EXECUTION_TIMEOUT;
  data: {
    /** Script hash (NOT the full script - security!) */
    scriptHash: string;
    /** Script length in characters */
    scriptLength: number;
    /** Number of tool calls made */
    toolCallCount?: number;
    /** Error message (sanitized) if failed */
    error?: string;
  };
}

/**
 * Tool call audit event.
 */
export interface ToolCallAuditEvent extends AuditEvent {
  type:
    | typeof AUDIT_EVENT_TYPES.TOOL_CALL_START
    | typeof AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS
    | typeof AUDIT_EVENT_TYPES.TOOL_CALL_FAILURE;
  data: {
    /** Tool name */
    toolName: string;
    /** Call depth (nested calls) */
    callDepth: number;
    /** Error code if failed */
    errorCode?: string;
  };
}

/**
 * Security audit event.
 */
export interface SecurityAuditEvent extends AuditEvent {
  type:
    | typeof AUDIT_EVENT_TYPES.SECURITY_SELF_REFERENCE
    | typeof AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED
    | typeof AUDIT_EVENT_TYPES.SECURITY_AST_BLOCKED;
  data: {
    /** What was blocked */
    blocked: string;
    /** Reason for blocking */
    reason: string;
  };
}

/**
 * Audit event listener function type.
 */
export type AuditEventListener = (event: AuditEvent) => void;

/**
 * Audit Logger Service
 *
 * Provides centralized audit logging for all CodeCall operations.
 * Uses the SDK event emitter pattern for integration with external systems.
 *
 * Security considerations:
 * - NEVER logs full scripts (only hashes)
 * - NEVER logs tool inputs/outputs (only metadata)
 * - NEVER logs sensitive error details (only sanitized messages)
 * - All events include execution ID for correlation
 */
@Provider({
  name: 'codecall:audit-logger',
  scope: ProviderScope.GLOBAL,
})
export class AuditLoggerService {
  private listeners: Set<AuditEventListener> = new Set();
  private executionCounter = 0;

  /**
   * Subscribe to audit events.
   *
   * @param listener - Function to call when events occur
   * @returns Unsubscribe function
   */
  subscribe(listener: AuditEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Generate a unique execution ID.
   */
  generateExecutionId(): string {
    const timestamp = Date.now().toString(36);
    const counter = (++this.executionCounter).toString(36).padStart(4, '0');
    const random = Math.random().toString(36).substring(2, 8);
    return `exec_${timestamp}_${counter}_${random}`;
  }

  /**
   * Log execution start.
   */
  logExecutionStart(executionId: string, script: string): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.EXECUTION_START,
      timestamp: new Date().toISOString(),
      executionId,
      data: {
        scriptHash: this.hashScript(script),
        scriptLength: script.length,
      },
    });
  }

  /**
   * Log execution success.
   */
  logExecutionSuccess(executionId: string, script: string, durationMs: number, toolCallCount: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.EXECUTION_SUCCESS,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        scriptHash: this.hashScript(script),
        scriptLength: script.length,
        toolCallCount,
      },
    });
  }

  /**
   * Log execution failure.
   */
  logExecutionFailure(executionId: string, script: string, durationMs: number, error: string): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.EXECUTION_FAILURE,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        scriptHash: this.hashScript(script),
        scriptLength: script.length,
        error: this.sanitizeError(error),
      },
    });
  }

  /**
   * Log execution timeout.
   */
  logExecutionTimeout(executionId: string, script: string, durationMs: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.EXECUTION_TIMEOUT,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        scriptHash: this.hashScript(script),
        scriptLength: script.length,
      },
    });
  }

  /**
   * Log tool call start.
   */
  logToolCallStart(executionId: string, toolName: string, callDepth: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.TOOL_CALL_START,
      timestamp: new Date().toISOString(),
      executionId,
      data: {
        toolName,
        callDepth,
      },
    });
  }

  /**
   * Log tool call success.
   */
  logToolCallSuccess(executionId: string, toolName: string, callDepth: number, durationMs: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.TOOL_CALL_SUCCESS,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        toolName,
        callDepth,
      },
    });
  }

  /**
   * Log tool call failure.
   */
  logToolCallFailure(
    executionId: string,
    toolName: string,
    callDepth: number,
    durationMs: number,
    errorCode: string,
  ): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.TOOL_CALL_FAILURE,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        toolName,
        callDepth,
        errorCode,
      },
    });
  }

  /**
   * Log security event: self-reference blocked.
   */
  logSecuritySelfReference(executionId: string, toolName: string): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.SECURITY_SELF_REFERENCE,
      timestamp: new Date().toISOString(),
      executionId,
      data: {
        blocked: toolName,
        reason: 'Self-reference attack: attempted to call CodeCall tool from within AgentScript',
      },
    });
  }

  /**
   * Log security event: access denied.
   */
  logSecurityAccessDenied(executionId: string, toolName: string, reason: string): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.SECURITY_ACCESS_DENIED,
      timestamp: new Date().toISOString(),
      executionId,
      data: {
        blocked: toolName,
        reason: this.sanitizeError(reason),
      },
    });
  }

  /**
   * Log security event: AST validation blocked.
   */
  logSecurityAstBlocked(executionId: string, pattern: string, reason: string): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.SECURITY_AST_BLOCKED,
      timestamp: new Date().toISOString(),
      executionId,
      data: {
        blocked: pattern,
        reason: this.sanitizeError(reason),
      },
    });
  }

  /**
   * Log search operation.
   */
  logSearch(executionId: string, query: string, resultCount: number, durationMs: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.SEARCH_PERFORMED,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        queryLength: query.length,
        resultCount,
      },
    });
  }

  /**
   * Log describe operation.
   */
  logDescribe(executionId: string, toolNames: string[], durationMs: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.DESCRIBE_PERFORMED,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        toolCount: toolNames.length,
        toolNames: toolNames.slice(0, 10), // Limit to first 10 for audit
      },
    });
  }

  /**
   * Log invoke operation.
   */
  logInvoke(executionId: string, toolName: string, success: boolean, durationMs: number): void {
    this.emit({
      type: AUDIT_EVENT_TYPES.INVOKE_PERFORMED,
      timestamp: new Date().toISOString(),
      executionId,
      durationMs,
      data: {
        toolName,
        success,
      },
    });
  }

  /**
   * Emit an audit event to all listeners.
   */
  private emit(event: AuditEvent): void {
    // Freeze the event to prevent modification
    const frozenEvent = Object.freeze({ ...event, data: Object.freeze({ ...event.data }) });

    for (const listener of this.listeners) {
      try {
        listener(frozenEvent);
      } catch {
        // Never let listener errors propagate
      }
    }
  }

  /**
   * Create a simple hash of the script for identification.
   * Uses a fast, non-cryptographic hash for performance.
   */
  private hashScript(script: string): string {
    let hash = 0;
    for (let i = 0; i < script.length; i++) {
      const char = script.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `sh_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  /**
   * Sanitize error messages to remove sensitive information.
   */
  private sanitizeError(error: string): string {
    if (!error) return 'Unknown error';

    // Remove file paths
    let sanitized = error.replace(/(?:\/[\w.-]+)+|(?:[A-Za-z]:\\[\w\\.-]+)+/g, '[path]');

    // Remove line numbers
    sanitized = sanitized.replace(/:\d+:\d+/g, '');

    // Remove stack traces
    sanitized = sanitized.replace(/\n\s*at .*/g, '');

    // Truncate
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200) + '...';
    }

    return sanitized.trim();
  }
}

export default AuditLoggerService;
