import { PublicMcpError, MCP_ERROR_CODES } from '@frontmcp/sdk';
import type { ApprovalScope } from './approval.types';

/**
 * Error thrown when tool approval is required but not granted.
 */
export class ApprovalRequiredError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_REQUEST;

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

  override getPublicMessage(): string {
    return this.details.message;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
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
export class ApprovalOperationError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INTERNAL_ERROR;

  constructor(public readonly operation: 'grant' | 'revoke' | 'query', public readonly reason: string) {
    super(`Approval ${operation} failed: ${reason}`);
    this.name = 'ApprovalOperationError';
  }

  override getPublicMessage(): string {
    return `Approval operation failed`;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
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
export class ApprovalScopeNotAllowedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;

  constructor(public readonly requestedScope: ApprovalScope, public readonly allowedScopes: ApprovalScope[]) {
    super(
      `Approval scope '${requestedScope}' is not allowed for this tool. ` +
        `Allowed scopes: ${allowedScopes.join(', ')}`,
    );
    this.name = 'ApprovalScopeNotAllowedError';
  }

  override getPublicMessage(): string {
    return this.message;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: {
        type: 'approval_scope_not_allowed',
        requestedScope: this.requestedScope,
        allowedScopes: this.allowedScopes,
      },
    };
  }
}
