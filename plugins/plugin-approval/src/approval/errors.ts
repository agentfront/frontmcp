/**
 * Error classes for approval operations.
 *
 * They are public MCP errors: a refusal is an answer for the caller, so its message reaches the
 * client as written, in every environment, instead of being wrapped as an internal server error.
 *
 * @module @frontmcp/plugin-approval
 */

import { PublicMcpError } from '@frontmcp/sdk';

import type { ApprovalScope } from './types';

/**
 * Base class for approval-related errors.
 */
export class ApprovalError extends PublicMcpError {
  constructor(message: string, code = 'APPROVAL_REQUIRED', statusCode = 403) {
    super(message, code, statusCode);
    this.name = 'ApprovalError';
  }
}

/**
 * Error thrown when tool approval is required but not granted.
 */
export class ApprovalRequiredError extends ApprovalError {
  constructor(
    public readonly details: {
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
    },
  ) {
    super(details.message);
    this.name = 'ApprovalRequiredError';
  }

  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError() {
    return {
      code: -32600, // Invalid Request
      message: this.details.message,
      data: {
        type: 'approval_required',
        toolId: this.details.toolId,
        state: this.details.state,
        options: this.details.approvalOptions,
      },
    };
  }
}

/**
 * Error thrown when approval operation fails.
 */
export class ApprovalOperationError extends ApprovalError {
  constructor(
    public readonly operation: 'grant' | 'revoke' | 'query',
    public readonly reason: string,
  ) {
    super(`Approval ${operation} failed: ${reason}`, 'APPROVAL_OPERATION_FAILED', 400);
    this.name = 'ApprovalOperationError';
  }

  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError() {
    return {
      code: -32603, // Internal Error
      message: 'Approval operation failed',
      data: {
        type: 'approval_operation_error',
        operation: this.operation,
      },
    };
  }
}

/**
 * Error thrown when approval scope is not allowed.
 */
export class ApprovalScopeNotAllowedError extends ApprovalError {
  constructor(
    public readonly requestedScope: ApprovalScope,
    public readonly allowedScopes: ApprovalScope[],
  ) {
    super(
      `Approval scope '${requestedScope}' is not allowed for this tool. ` +
        `Allowed scopes: ${allowedScopes.join(', ')}`,
      'APPROVAL_SCOPE_NOT_ALLOWED',
      400,
    );
    this.name = 'ApprovalScopeNotAllowedError';
  }

  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError() {
    return {
      code: -32602, // Invalid Params
      message: this.message,
      data: {
        type: 'approval_scope_not_allowed',
        requestedScope: this.requestedScope,
        allowedScopes: this.allowedScopes,
      },
    };
  }
}

/**
 * Error thrown when approval has expired.
 */
export class ApprovalExpiredError extends ApprovalError {
  constructor(
    public readonly toolId: string,
    public readonly expiredAt: number,
  ) {
    super(`Approval for tool '${toolId}' expired at ${new Date(expiredAt).toISOString()}`, 'APPROVAL_EXPIRED', 403);
    this.name = 'ApprovalExpiredError';
  }

  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError() {
    return {
      code: -32600, // Invalid Request
      message: this.message,
      data: {
        type: 'approval_expired',
        toolId: this.toolId,
        expiredAt: this.expiredAt,
      },
    };
  }
}

/**
 * Error thrown when PKCE challenge validation fails.
 */
export class ChallengeValidationError extends ApprovalError {
  constructor(
    public readonly reason: 'invalid' | 'expired' | 'not_found' | 'already_used' = 'invalid',
    message?: string,
  ) {
    super(message ?? `PKCE challenge validation failed: ${reason}`, 'CHALLENGE_VALIDATION_FAILED', 400);
    this.name = 'ChallengeValidationError';
  }

  /**
   * Convert to a JSON-RPC compatible error structure.
   */
  toJsonRpcError() {
    return {
      code: -32600, // Invalid Request
      message: this.message,
      data: {
        type: 'challenge_validation_error',
        reason: this.reason,
      },
    };
  }
}
