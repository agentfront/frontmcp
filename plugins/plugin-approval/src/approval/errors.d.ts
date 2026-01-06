/**
 * Error classes for approval operations.
 *
 * These are standalone error classes that can be extended by plugins
 * for MCP-specific error handling.
 *
 * @module @frontmcp/plugin-approval
 */
import type { ApprovalScope } from './types';
/**
 * Base class for approval-related errors.
 */
export declare class ApprovalError extends Error {
  constructor(message: string);
}
/**
 * Error thrown when tool approval is required but not granted.
 */
export declare class ApprovalRequiredError extends ApprovalError {
  readonly details: {
    /** Tool identifier */
    toolId: string;
    /** Current approval state */
    state: 'pending' | 'denied' | 'expired';
    /** User-facing message */
    message: string;
    /** Available approval options (for UI) */
    approvalOptions?: {
      allowedScopes?: ApprovalScope[];
      defaultScope?: ApprovalScope;
      maxTtlMs?: number;
      category?: string;
      riskLevel?: string;
    };
  };
  constructor(details: {
    /** Tool identifier */
    toolId: string;
    /** Current approval state */
    state: 'pending' | 'denied' | 'expired';
    /** User-facing message */
    message: string;
    /** Available approval options (for UI) */
    approvalOptions?: {
      allowedScopes?: ApprovalScope[];
      defaultScope?: ApprovalScope;
      maxTtlMs?: number;
      category?: string;
      riskLevel?: string;
    };
  });
  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: {
      type: string;
      toolId: string;
      state: 'pending' | 'denied' | 'expired';
      options:
        | {
            allowedScopes?: ApprovalScope[];
            defaultScope?: ApprovalScope;
            maxTtlMs?: number;
            category?: string;
            riskLevel?: string;
          }
        | undefined;
    };
  };
}
/**
 * Error thrown when approval operation fails.
 */
export declare class ApprovalOperationError extends ApprovalError {
  readonly operation: 'grant' | 'revoke' | 'query';
  readonly reason: string;
  constructor(operation: 'grant' | 'revoke' | 'query', reason: string);
  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: {
      type: string;
      operation: 'grant' | 'revoke' | 'query';
    };
  };
}
/**
 * Error thrown when approval scope is not allowed.
 */
export declare class ApprovalScopeNotAllowedError extends ApprovalError {
  readonly requestedScope: ApprovalScope;
  readonly allowedScopes: ApprovalScope[];
  constructor(requestedScope: ApprovalScope, allowedScopes: ApprovalScope[]);
  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: {
      type: string;
      requestedScope: ApprovalScope;
      allowedScopes: ApprovalScope[];
    };
  };
}
/**
 * Error thrown when approval has expired.
 */
export declare class ApprovalExpiredError extends ApprovalError {
  readonly toolId: string;
  readonly expiredAt: number;
  constructor(toolId: string, expiredAt: number);
  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: {
      type: string;
      toolId: string;
      expiredAt: number;
    };
  };
}
/**
 * Error thrown when PKCE challenge validation fails.
 */
export declare class ChallengeValidationError extends ApprovalError {
  readonly reason: 'invalid' | 'expired' | 'not_found' | 'already_used';
  constructor(reason?: 'invalid' | 'expired' | 'not_found' | 'already_used', message?: string);
  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: {
      type: string;
      reason: 'expired' | 'invalid' | 'not_found' | 'already_used';
    };
  };
}
