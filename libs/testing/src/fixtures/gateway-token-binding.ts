import { trimSlashes, trimTrailing } from '@frontmcp/utils';

/**
 * The `iss` and `aud` a gateway-mode server (public, local or remote mode,
 * HS256 tokens signed with `JWT_SECRET`) puts on the tokens it mints, and
 * requires on the tokens it accepts (#269).
 *
 * Both are the server's MCP URL: its address plus `http.entryPath`, normalized
 * the way the server does it (`'mcp'`, `'/mcp'` and `'/mcp/'` are the same
 * path, and a root entry path adds nothing).
 */
export function gatewayTokenBinding(serverUrl: string, entryPath?: string): { issuer: string; audience: string } {
  const base = trimTrailing(serverUrl, '/');
  const prefix = trimSlashes(entryPath ?? '');
  const mcpUrl = prefix ? `${base}/${prefix}` : base;
  return { issuer: mcpUrl, audience: mcpUrl };
}
