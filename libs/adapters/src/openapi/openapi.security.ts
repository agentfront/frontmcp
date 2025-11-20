import {
  SecurityResolver,
  createSecurityContext,
  type McpOpenAPITool,
  type SecurityContext,
} from 'mcp-from-openapi';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OpenApiAdapterOptions } from './openapi.types';

/**
 * Security scheme information extracted from OpenAPI spec
 */
export interface SecuritySchemeInfo {
  name: string;
  type: string;
  scheme?: string;
  in?: string;
  description?: string;
}

/**
 * Security validation result
 */
export interface SecurityValidationResult {
  valid: boolean;
  missingMappings: string[];
  warnings: string[];
  securityRiskScore: 'low' | 'medium' | 'high';
}

/**
 * Resolve security context from FrontMCP auth info with support for multiple auth providers
 *
 * @param tool - OpenAPI tool to resolve security for
 * @param authInfo - FrontMCP authentication info
 * @param options - Adapter options with auth configuration
 * @returns Security context for resolver
 */
export async function createSecurityContextFromAuth(
  tool: McpOpenAPITool,
  authInfo: AuthInfo,
  options: Pick<OpenApiAdapterOptions, 'securityResolver' | 'authProviderMapper' | 'staticAuth'>
): Promise<SecurityContext> {
  // 1. Use custom security resolver if provided (highest priority)
  if (options.securityResolver) {
    return await options.securityResolver(tool, authInfo);
  }

  // 2. Use auth provider mapper if provided
  if (options.authProviderMapper) {
    const context = createSecurityContext({});

    // Find all security schemes used by this tool
    const securitySchemes = new Set<string>();
    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme) {
        securitySchemes.add(mapper.security.scheme);
      }
    }

    // Map each security scheme to its auth provider
    for (const scheme of securitySchemes) {
      const authExtractor = options.authProviderMapper[scheme];
      if (authExtractor) {
        const token = authExtractor(authInfo);
        if (token) {
          // Store in jwt field for http bearer auth
          // For other auth types, you can extend this logic
          context.jwt = token;
          break; // Use first matching provider
        }
      }
    }

    // If no provider matched but we have a default token, use it
    if (!context.jwt && authInfo.token) {
      context.jwt = authInfo.token;
    }

    return context;
  }

  // 3. Use static auth if provided
  if (options.staticAuth) {
    return createSecurityContext(options.staticAuth);
  }

  // 4. Default: use main JWT token from auth context
  return createSecurityContext({
    jwt: authInfo?.token,
  });
}

/**
 * Extract all security schemes used by a set of tools
 *
 * @param tools - OpenAPI tools
 * @returns Set of security scheme names
 */
export function extractSecuritySchemes(tools: McpOpenAPITool[]): Set<string> {
  const schemes = new Set<string>();

  for (const tool of tools) {
    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme) {
        schemes.add(mapper.security.scheme);
      }
    }
  }

  return schemes;
}

/**
 * Validate security configuration against OpenAPI security requirements
 *
 * @param tools - OpenAPI tools
 * @param options - Adapter options
 * @returns Validation result with errors and warnings
 */
export function validateSecurityConfiguration(
  tools: McpOpenAPITool[],
  options: Pick<
    OpenApiAdapterOptions,
    'securityResolver' | 'authProviderMapper' | 'staticAuth' | 'generateOptions'
  >
): SecurityValidationResult {
  const result: SecurityValidationResult = {
    valid: true,
    missingMappings: [],
    warnings: [],
    securityRiskScore: 'low',
  };

  // Extract all security schemes used
  const securitySchemes = extractSecuritySchemes(tools);

  // If includeSecurityInInput is true, auth is provided by user (high security risk)
  const includeSecurityInInput = options.generateOptions?.includeSecurityInInput ?? false;

  if (includeSecurityInInput) {
    result.securityRiskScore = 'high';
    result.warnings.push(
      'SECURITY WARNING: includeSecurityInInput is enabled. Users will provide authentication directly in tool inputs. This increases security risk as credentials may be logged or exposed.'
    );
    // Don't validate mappings if security is in input
    return result;
  }

  // Check if we have custom security resolver (most flexible, low risk)
  if (options.securityResolver) {
    result.securityRiskScore = 'low';
    result.warnings.push(
      'INFO: Using custom securityResolver. Ensure your resolver properly validates and secures credentials from context.'
    );
    return result;
  }

  // Check if we have static auth (medium risk - static credentials)
  if (options.staticAuth && Object.keys(options.staticAuth).length > 0) {
    result.securityRiskScore = 'medium';
    result.warnings.push(
      'SECURITY INFO: Using staticAuth with hardcoded credentials. Ensure credentials are stored securely (environment variables, secrets manager).'
    );
    // If static auth is provided, assume it covers all schemes
    return result;
  }

  // Check authProviderMapper (low risk - context-based auth)
  if (options.authProviderMapper) {
    result.securityRiskScore = 'low';

    // Validate that all schemes have mappings
    for (const scheme of securitySchemes) {
      if (!options.authProviderMapper[scheme]) {
        result.valid = false;
        result.missingMappings.push(scheme);
      }
    }

    if (!result.valid) {
      result.warnings.push(
        `ERROR: Missing auth provider mappings for security schemes: ${result.missingMappings.join(', ')}`
      );
    }

    return result;
  }

  // No auth configuration provided - will use default ctx.authInfo.token
  // This only works if there's a single Bearer auth scheme
  if (securitySchemes.size > 0) {
    result.securityRiskScore = 'medium';
    result.warnings.push(
      `INFO: No auth configuration provided. Using default ctx.authInfo.token for all security schemes: ${Array.from(securitySchemes).join(', ')}`
    );
    result.warnings.push(
      'RECOMMENDATION: For multiple auth providers, use authProviderMapper or securityResolver to map each security scheme to the correct auth provider.'
    );
  }

  return result;
}

/**
 * Resolve security for an OpenAPI tool with validation
 *
 * @param tool - OpenAPI tool with mapper
 * @param authInfo - FrontMCP authentication info
 * @param options - Adapter options with auth configuration
 * @returns Resolved security (headers, query params, etc.)
 * @throws Error if security cannot be resolved
 */
export async function resolveToolSecurity(
  tool: McpOpenAPITool,
  authInfo: AuthInfo,
  options: Pick<OpenApiAdapterOptions, 'securityResolver' | 'authProviderMapper' | 'staticAuth'>
) {
  const securityResolver = new SecurityResolver();
  const securityContext = await createSecurityContextFromAuth(tool, authInfo, options);

  // Validate that we have auth for this tool
  const hasAuth =
    securityContext.jwt ||
    securityContext.apiKey ||
    securityContext.basic ||
    securityContext.oauth2Token ||
    (securityContext.apiKeys && Object.keys(securityContext.apiKeys).length > 0) ||
    (securityContext.customHeaders && Object.keys(securityContext.customHeaders).length > 0);

  // Check if this tool requires security
  const requiresSecurity = tool.mapper.some((m) => m.security && m.required);

  if (requiresSecurity && !hasAuth) {
    // Extract security scheme names
    const schemes = tool.mapper
      .filter((m) => m.security && m.required)
      .map((m) => m.security?.scheme ?? 'unknown')
      .join(', ');

    throw new Error(
      `Authentication required for tool '${tool.name}' but no auth configuration found.\n` +
        `Required security schemes: ${schemes}\n` +
        `Solutions:\n` +
        `  1. Add authProviderMapper: { '${schemes.split(',')[0].trim()}': (authInfo) => authInfo.user?.token }\n` +
        `  2. Add securityResolver: (tool, authInfo) => ({ jwt: authInfo.token })\n` +
        `  3. Add staticAuth: { jwt: process.env.API_TOKEN }\n` +
        `  4. Set generateOptions.includeSecurityInInput: true (not recommended for production)`
    );
  }

  return await securityResolver.resolve(tool.mapper, securityContext);
}
