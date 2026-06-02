/**
 * Tool Credentials Required Error
 *
 * Thrown by the `checkToolCredentials` stage of the call-tool flow when a tool
 * declares one or more `authProviders` with `required: true` (the default) and
 * the credential for at least one of them is NOT available for the current
 * authenticated session.
 *
 * This is the TOOL-LEVEL credential gate — distinct from {@link AuthorizationRequiredError},
 * which gates at the APP level (progressive app authorization). A tool can be
 * reachable (its app authorized) yet still miss a per-provider credential; this
 * error covers that case and aborts the call BEFORE `execute()` runs.
 *
 * Mapped to JSON-RPC `-32001` (MCP `UNAUTHORIZED`) so clients can distinguish a
 * missing-credential gate from a missing tool (`-32601`) or a withheld/consent
 * tool (`-32003`). The `data` payload carries the offending provider id(s) and
 * an `authUrl` (a framework-signed connect/authorize URL) the client/agent can
 * open to (re)authorize. Both `authUrl` (camelCase, primary) and `auth_url`
 * (snake_case, matching {@link AuthorizationRequiredError}'s convention) are
 * emitted so either naming convention resolves.
 */
import { MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/** JSON-RPC `data` payload for {@link ToolCredentialsRequiredError}. */
export interface ToolCredentialsRequiredData {
  /** The tool that required the missing credential(s). */
  tool: string;
  /** Provider id(s) whose credential is required but unavailable. */
  providers: string[];
  /** Framework-signed connect/authorize URL (camelCase, primary). */
  authUrl?: string;
  /** Same URL under the snake_case key used by AuthorizationRequiredError. */
  auth_url?: string;
}

export class ToolCredentialsRequiredError extends PublicMcpError {
  /** JSON-RPC code: MCP UNAUTHORIZED (-32001). */
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  /** Tool id that triggered the gate. */
  readonly toolId: string;

  /** Provider id(s) whose credential is required but missing. */
  readonly providers: string[];

  /** Connect/authorize URL to (re)authorize the provider(s), if resolvable. */
  readonly authUrl?: string;

  constructor(params: { toolId: string; providers: string[]; authUrl?: string; message?: string }) {
    const providerList = params.providers.join(', ');
    const defaultMessage =
      `Tool "${params.toolId}" requires credentials for ${providerList} which are not connected for this session. ` +
      (params.authUrl ? `Connect via: ${params.authUrl}` : `Please authorize the required provider(s) and retry.`);

    super(params.message || defaultMessage, 'TOOL_CREDENTIALS_REQUIRED', 401);
    this.toolId = params.toolId;
    this.providers = params.providers;
    this.authUrl = params.authUrl;
  }

  /**
   * Convert to JSON-RPC error format per MCP specification.
   *
   * @example
   * {
   *   "code": -32001,
   *   "message": "Tool \"deploy_app\" requires credentials for github ...",
   *   "data": {
   *     "tool": "deploy_app",
   *     "providers": ["github"],
   *     "authUrl": "https://.../oauth/connect?token=…",
   *     "auth_url": "https://.../oauth/connect?token=…"
   *   }
   * }
   */
  toJsonRpcError(): {
    code: number;
    message: string;
    data: ToolCredentialsRequiredData;
  } {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: {
        tool: this.toolId,
        providers: this.providers,
        ...(this.authUrl ? { authUrl: this.authUrl, auth_url: this.authUrl } : {}),
      },
    };
  }
}
