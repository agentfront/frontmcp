/**
 * Authorization Required Error
 *
 * Thrown when a tool requires app-level authorization that the user has not granted.
 * Used for progressive/incremental authorization flow where users can skip apps
 * during initial auth and authorize later when needed.
 *
 * Behavior depends on session mode:
 * - Stateful: Returns auth_url link for incremental authorization
 * - Stateless: Returns unauthorized error (no link, must re-auth from scratch)
 *
 * Supports MCP elicit flow for clients that support it.
 */
import { z } from 'zod';
import { PublicMcpError } from './mcp.error';

// ============================================
// Session Mode Types
// ============================================

/**
 * Session mode determines how authorization state is stored
 */
export type SessionMode = 'stateful' | 'stateless';

/**
 * Elicit response type for clients that support elicit flow
 */
export const elicitResponseSchema = z.object({
  /** Elicit request ID for tracking */
  elicitId: z.string(),
  /** Authorization URL to display */
  authUrl: z.string().url(),
  /** Message to display to user */
  message: z.string(),
  /** App being authorized */
  appId: z.string(),
  /** Tool that triggered auth */
  toolId: z.string(),
});

export type ElicitResponse = z.infer<typeof elicitResponseSchema>;

// ============================================
// Schemas
// ============================================

/**
 * Schema for authorization required response data (stateful mode with link)
 */
export const authorizationRequiredDataSchema = z.object({
  /** Error type identifier */
  error: z.literal('authorization_required'),
  /** App ID that requires authorization */
  app: z.string().min(1),
  /** Tool ID that triggered the authorization requirement */
  tool: z.string().min(1),
  /** URL to authorize the app (only in stateful mode) */
  auth_url: z.string().url().optional(),
  /** Human-readable message */
  message: z.string(),
  /** Scopes required by the tool (optional) */
  required_scopes: z.array(z.string()).optional(),
  /** Session mode that determines behavior */
  session_mode: z.enum(['stateful', 'stateless']).optional(),
  /** Whether elicit flow is being used */
  elicit_id: z.string().optional(),
  /** Whether client can use incremental auth link */
  supports_incremental: z.boolean().optional(),
});

/**
 * Schema for authorization required error constructor params
 */
export const authorizationRequiredParamsSchema = z.object({
  appId: z.string().min(1),
  toolId: z.string().min(1),
  authUrl: z.string().optional(),
  requiredScopes: z.array(z.string()).optional(),
  message: z.string().optional(),
  /** Session mode - determines if auth link is included */
  sessionMode: z.enum(['stateful', 'stateless']).optional(),
  /** Elicit ID if using elicit flow */
  elicitId: z.string().optional(),
  /** Vault ID for stateful sessions */
  vaultId: z.string().optional(),
  /** Pending auth ID for tracking */
  pendingAuthId: z.string().optional(),
});

/**
 * Schema for the _meta field in MCP error response
 */
export const authorizationRequiredMetaSchema = z.object({
  errorId: z.string(),
  code: z.string(),
  timestamp: z.string(),
  authorization_required: z.literal(true),
  app: z.string(),
  tool: z.string(),
  auth_url: z.string().optional(),
  required_scopes: z.array(z.string()).optional(),
  session_mode: z.enum(['stateful', 'stateless']),
  supports_incremental: z.boolean(),
  elicit_id: z.string().optional(),
  pending_auth_id: z.string().optional(),
});

// ============================================
// Types (inferred from schemas)
// ============================================

/**
 * Data structure for authorization required responses
 */
export type AuthorizationRequiredData = z.infer<typeof authorizationRequiredDataSchema>;

/**
 * Constructor params for AuthorizationRequiredError
 */
export type AuthorizationRequiredParams = z.infer<typeof authorizationRequiredParamsSchema>;

/**
 * Meta field type for MCP error response
 */
export type AuthorizationRequiredMeta = z.infer<typeof authorizationRequiredMetaSchema>;

// ============================================
// Error Class
// ============================================

/**
 * Error thrown when a tool's parent app requires authorization.
 * This enables progressive authorization where users can authorize apps
 * incrementally as needed rather than all at once.
 *
 * Behavior depends on session mode:
 * - **Stateful**: Returns auth_url link for incremental authorization
 *   - User can click link to authorize without full re-authentication
 *   - Supports elicit flow for interactive authorization
 * - **Stateless**: Returns unauthorized error only
 *   - No link provided (all state in JWT, cannot extend)
 *   - User must re-authenticate from scratch
 *
 * @example
 * ```typescript
 * // Stateful mode - can provide auth link
 * throw new AuthorizationRequiredError({
 *   appId: 'slack',
 *   toolId: 'slack:send_message',
 *   authUrl: '/oauth/authorize?app=slack',
 *   sessionMode: 'stateful',
 *   message: 'Please authorize Slack to use this tool.',
 * });
 *
 * // Stateless mode - no link, must re-auth
 * throw new AuthorizationRequiredError({
 *   appId: 'slack',
 *   toolId: 'slack:send_message',
 *   sessionMode: 'stateless',
 *   message: 'You are not authorized to use this tool.',
 * });
 * ```
 */
export class AuthorizationRequiredError extends PublicMcpError {
  /** App ID that requires authorization */
  readonly appId: string;

  /** Tool ID that triggered the authorization requirement */
  readonly toolId: string;

  /** URL to authorize the app (only available in stateful mode) */
  readonly authUrl?: string;

  /** Scopes required by the tool (optional) */
  readonly requiredScopes?: string[];

  /** Session mode determines if incremental auth is supported */
  readonly sessionMode: SessionMode;

  /** Elicit ID if using elicit flow */
  readonly elicitId?: string;

  /** Vault ID for stateful sessions */
  readonly vaultId?: string;

  /** Pending auth ID for tracking */
  readonly pendingAuthId?: string;

  /** Whether incremental authorization is supported */
  readonly supportsIncremental: boolean;

  constructor(params: AuthorizationRequiredParams) {
    const sessionMode = params.sessionMode ?? 'stateful';
    const supportsIncremental = sessionMode === 'stateful';

    // Message differs based on mode
    const defaultMessage = supportsIncremental
      ? `Authorization required for ${params.appId}. Please authorize to use ${params.toolId}.`
      : `You are not authorized to use ${params.toolId}. Please re-authenticate to access this tool.`;

    super(params.message || defaultMessage, 'AUTHORIZATION_REQUIRED', 403);
    this.appId = params.appId;
    this.toolId = params.toolId;
    this.sessionMode = sessionMode;
    this.supportsIncremental = supportsIncremental;

    // Only set authUrl in stateful mode
    if (supportsIncremental && params.authUrl) {
      this.authUrl = params.authUrl;
    }

    this.requiredScopes = params.requiredScopes;
    this.elicitId = params.elicitId;
    this.vaultId = params.vaultId;
    this.pendingAuthId = params.pendingAuthId;
  }

  /**
   * Convert to MCP error response format with authorization metadata.
   * The _meta field includes structured data that AI agents can use
   * to prompt users for authorization.
   *
   * In stateful mode: includes auth_url for AI to display
   * In stateless mode: no auth_url, AI should inform user to re-authenticate
   */
  override toMcpError(isDevelopment?: boolean): {
    content: Array<{ type: 'text'; text: string }>;
    isError: true;
    _meta: AuthorizationRequiredMeta;
  } {
    // Build content text based on mode
    let contentText = this.getPublicMessage();
    if (this.supportsIncremental && this.authUrl) {
      contentText += `\n\nTo authorize, click: ${this.authUrl}`;
    } else if (!this.supportsIncremental) {
      contentText += '\n\nPlease re-authenticate to access this tool.';
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: contentText,
        },
      ],
      isError: true as const,
      _meta: {
        errorId: this.errorId,
        code: this.code,
        timestamp: new Date().toISOString(),
        // Progressive auth specific fields for AI agents to use
        authorization_required: true as const,
        app: this.appId,
        tool: this.toolId,
        auth_url: this.authUrl,
        required_scopes: this.requiredScopes,
        session_mode: this.sessionMode,
        supports_incremental: this.supportsIncremental,
        elicit_id: this.elicitId,
        pending_auth_id: this.pendingAuthId,
      },
    };
  }

  /**
   * Convert to structured authorization required data
   */
  toAuthorizationRequiredData(): AuthorizationRequiredData {
    return {
      error: 'authorization_required',
      app: this.appId,
      tool: this.toolId,
      auth_url: this.authUrl,
      message: this.getPublicMessage(),
      required_scopes: this.requiredScopes,
      session_mode: this.sessionMode,
      elicit_id: this.elicitId,
      supports_incremental: this.supportsIncremental,
    };
  }

  /**
   * Create an elicit response for clients that support it
   * Only available in stateful mode
   */
  toElicitResponse(): ElicitResponse | null {
    if (!this.supportsIncremental || !this.authUrl || !this.elicitId) {
      return null;
    }

    return {
      elicitId: this.elicitId,
      authUrl: this.authUrl,
      message: this.getPublicMessage(),
      appId: this.appId,
      toolId: this.toolId,
    };
  }

  /**
   * Check if this error can be resolved via incremental auth link
   */
  canUseIncrementalAuth(): boolean {
    return this.supportsIncremental && !!this.authUrl;
  }

  /**
   * Get user-facing message based on mode
   * - Stateful: includes link text
   * - Stateless: tells user to re-authenticate
   */
  getUserFacingMessage(): string {
    if (this.supportsIncremental && this.authUrl) {
      return `${this.getPublicMessage()}\n\nClick here to authorize: ${this.authUrl}`;
    }
    return `${this.getPublicMessage()}\n\nYou are not authorized to use this tool. Please re-authenticate to access it.`;
  }

  /**
   * Get message for cancelled authorization
   */
  static getCancelledMessage(appId: string, toolId: string, authUrl?: string): string {
    const baseMsg = `Authorization was cancelled. You are not authorized to use ${toolId}.`;
    if (authUrl) {
      return `${baseMsg}\n\nIf you still want to use this tool, click this link to authorize: ${authUrl}\n\nThen re-prompt your request to try again.`;
    }
    return `${baseMsg}\n\nPlease re-authenticate and try again.`;
  }
}
