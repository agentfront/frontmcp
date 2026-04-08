/**
 * Authority Denied Error
 *
 * Thrown when an entry's authorities policy denies access.
 * Uses MCP FORBIDDEN error code (-32003) for JSON-RPC responses.
 */

import type { AuthoritiesDenial } from './authorities.types';

/**
 * MCP FORBIDDEN error code.
 * Duplicated here to avoid hard dependency on @frontmcp/sdk.
 */
const FORBIDDEN_CODE = -32003;

/**
 * Parameters for creating an AuthorityDeniedError.
 */
export interface AuthorityDeniedErrorParams {
  /** Entry type: 'Tool', 'Resource', 'Prompt', 'Skill', 'Agent' */
  entryType: string;
  /** Entry name (e.g., 'delete-user') */
  entryName: string;
  /** Policy that denied access (e.g., "roles.all: missing 'admin'") */
  deniedBy: string;
  /** Optional custom message */
  message?: string;
  /** Structured denial data (machine-parsable) */
  denial?: AuthoritiesDenial;
  /** Required scopes for scope challenges */
  requiredScopes?: string[];
}

/**
 * Error thrown when an authorities policy denies access.
 *
 * Extends the standard Error class. When used within the FrontMCP SDK,
 * the enforcement plugin maps this to the appropriate MCP error response
 * with code -32003 (FORBIDDEN).
 */
export class AuthorityDeniedError extends Error {
  /** MCP error code for JSON-RPC responses */
  readonly mcpErrorCode = FORBIDDEN_CODE;
  /** HTTP status code equivalent */
  readonly statusCode = 403;
  /** Error classification code */
  readonly code = 'AUTHORITY_DENIED';
  /** Entry type that was denied */
  readonly entryType: string;
  /** Entry name that was denied */
  readonly entryName: string;
  /** Policy that caused the denial */
  readonly deniedBy: string;
  /** Structured denial data (machine-parsable) */
  readonly denial?: AuthoritiesDenial;
  /** Required scopes for scope challenges */
  readonly requiredScopes?: string[];

  constructor(params: AuthorityDeniedErrorParams) {
    const msg = params.message ?? `Access denied to ${params.entryType} "${params.entryName}": ${params.deniedBy}`;
    super(msg);
    this.name = 'AuthorityDeniedError';
    this.entryType = params.entryType;
    this.entryName = params.entryName;
    this.deniedBy = params.deniedBy;
    this.denial = params.denial;
    this.requiredScopes = params.requiredScopes;
  }

  /**
   * Convert to JSON-RPC error format.
   */
  toJsonRpcError(): { code: number; message: string; data?: Record<string, unknown> } {
    const data: Record<string, unknown> = {
      entryType: this.entryType,
      entryName: this.entryName,
      deniedBy: this.deniedBy,
    };
    if (this.denial !== undefined) data['denial'] = this.denial;
    if (this.requiredScopes !== undefined) data['requiredScopes'] = this.requiredScopes;
    return {
      code: this.mcpErrorCode,
      message: this.message,
      data,
    };
  }
}
