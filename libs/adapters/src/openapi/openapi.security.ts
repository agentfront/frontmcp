import { SecurityResolver, createSecurityContext, type McpOpenAPITool } from 'mcp-from-openapi';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Resolve security context from FrontMCP auth info
 *
 * @param authInfo - FrontMCP authentication info
 * @returns Security context for resolver
 */
export function createSecurityContextFromAuth(authInfo?: AuthInfo) {
  return createSecurityContext({
    jwt: authInfo?.token,
    // Additional auth types can be added via custom resolver in adapter options
  });
}

/**
 * Resolve security for an OpenAPI tool
 *
 * @param tool - OpenAPI tool with mapper
 * @param authInfo - FrontMCP authentication info
 * @returns Resolved security (headers, query params, etc.)
 */
export async function resolveToolSecurity(
  tool: McpOpenAPITool,
  authInfo?: AuthInfo
) {
  const securityResolver = new SecurityResolver();
  const securityContext = createSecurityContextFromAuth(authInfo);

  return await securityResolver.resolve(tool.mapper, securityContext);
}
