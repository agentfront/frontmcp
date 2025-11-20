/**
 * Example: Integrating OpenAPI tools with FrontMCP
 *
 * This example shows how to build a generic OpenAPI tool executor
 * that works with ANY OpenAPI spec, regardless of custom security naming.
 */

import {
  OpenAPIToolGenerator,
  SecurityResolver,
  createSecurityContext,
  type McpOpenAPITool,
  type SecurityContext,
  type ParameterMapper,
} from '../src';

/**
 * FrontMCP context (simplified example)
 */
interface FrontMcpContext {
  authInfo: {
    jwt?: string;
    sessionId?: string;
    payload?: Record<string, unknown>;
    apiKey?: string;
  };
}

/**
 * Generic OpenAPI tool executor for FrontMCP
 */
export class OpenAPIToolExecutor {
  private securityResolver = new SecurityResolver();

  /**
   * Execute an OpenAPI tool with FrontMCP context
   */
  async execute(
    tool: McpOpenAPITool,
    input: Record<string, unknown>,
    context: FrontMcpContext
  ): Promise<unknown> {
    // 1. Build security context from FrontMCP context
    const securityContext = this.buildSecurityContext(context);

    // 2. Validate required auth is available
    this.validateSecurity(tool, securityContext);

    // 3. Resolve security (handles ANY OpenAPI security scheme name)
    const security = await this.securityResolver.resolve(tool.mapper, securityContext);

    // 4. Build the HTTP request
    const request = this.buildRequest(tool, input, security);

    // 5. Execute the request
    return this.executeRequest(request);
  }

  /**
   * Build security context from FrontMCP context
   */
  private buildSecurityContext(context: FrontMcpContext): SecurityContext {
    return createSecurityContext({
      // Map FrontMCP's authInfo to standard security context
      jwt: context.authInfo.jwt,
      apiKey: context.authInfo.apiKey,

      // You can also add custom resolution logic
      customResolver: (security) => {
        // Example: resolve from session if JWT not available
        if (security.type === 'http' && security.httpScheme === 'bearer') {
          return context.authInfo.jwt || this.extractTokenFromSession(context);
        }

        // Example: resolve an API key from different sources
        if (security.type === 'apiKey') {
          return (
            context.authInfo.apiKey ||
            process.env[`${security.scheme.toUpperCase()}_API_KEY`] ||
            process.env.API_KEY
          );
        }

        return undefined;
      },
    });
  }

  /**
   * Validate that all required security is available
   */
  private validateSecurity(tool: McpOpenAPITool, context: SecurityContext): void {
    // Check if this tool requires security
    const requiresSecurity = tool.mapper.some((m) => m.security && m.required);

    if (!requiresSecurity) {
      return; // No security required
    }

    // Validate that we have some form of auth
    const hasAuth =
      context.jwt ||
      context.apiKey ||
      context.basic ||
      context.oauth2Token ||
      (context.apiKeys && Object.keys(context.apiKeys).length > 0) ||
      (context.customHeaders && Object.keys(context.customHeaders).length > 0);

    if (!hasAuth) {
      // Extract required security scheme names
      const schemes = tool.mapper
        .filter((m) => m.security && m.required)
        .map((m) => m.security?.scheme ?? 'unknown')
        .join(', ');

      throw new Error(
        `Authentication required for ${tool.name}:\n` +
          `Required security schemes: ${schemes}\n\n` +
          `Please provide authentication via context.authInfo or environment variables:\n` +
          `  - Set context.authInfo.jwt for Bearer authentication\n` +
          `  - Set context.authInfo.apiKey for API Key authentication\n` +
          `  - Or use customResolver in security context`
      );
    }
  }

  /**
   * Build HTTP request from tool, input, and resolved security
   */
  private buildRequest(
    tool: McpOpenAPITool,
    input: Record<string, unknown>,
    security: Awaited<ReturnType<typeof this.securityResolver.resolve>>
  ) {
    // Get base URL from tool metadata
    const baseUrl = tool.metadata.servers?.[0]?.url || '';

    // Build path with path parameters
    const path = this.buildPath(tool.metadata.path, tool.mapper, input);

    // Build query parameters (from input and security)
    const query = {
      ...security.query,
      ...this.buildQuery(tool.mapper, input),
    };

    // Build URL
    const url = new URL(path, baseUrl);
    Object.entries(query).forEach(([key, value]) => {
      url.searchParams.set(key, String(value));
    });

    // Build headers (from input and security)
    const headers = {
      ...security.headers,
      ...this.buildHeaders(tool.mapper, input),
      'Content-Type': 'application/json',
    };

    // Build body
    const body = this.buildBody(tool.mapper, input);

    return {
      url: url.toString(),
      method: tool.metadata.method.toUpperCase(),
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };
  }

  /**
   * Build path with path parameters replaced
   */
  private buildPath(
    pathTemplate: string,
    mappers: ParameterMapper[],
    input: Record<string, unknown>
  ): string {
    let path = pathTemplate;

    for (const mapper of mappers) {
      if (mapper.type === 'path' && mapper.inputKey in input) {
        const value = input[mapper.inputKey];
        path = path.replace(`{${mapper.key}}`, encodeURIComponent(String(value)));
      }
    }

    return path;
  }

  /**
   * Build query parameters from input
   */
  private buildQuery(
    mappers: ParameterMapper[],
    input: Record<string, unknown>
  ): Record<string, string> {
    const query: Record<string, string> = {};

    for (const mapper of mappers) {
      if (mapper.type === 'query' && mapper.inputKey in input && !mapper.security) {
        query[mapper.key] = String(input[mapper.inputKey]);
      }
    }

    return query;
  }

  /**
   * Build headers from input
   */
  private buildHeaders(
    mappers: ParameterMapper[],
    input: Record<string, unknown>
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    for (const mapper of mappers) {
      if (mapper.type === 'header' && mapper.inputKey in input && !mapper.security) {
        headers[mapper.key] = String(input[mapper.inputKey]);
      }
    }

    return headers;
  }

  /**
   * Build request body from input
   */
  private buildBody(
    mappers: ParameterMapper[],
    input: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    const body: Record<string, unknown> = {};
    let hasBody = false;

    for (const mapper of mappers) {
      if (mapper.type === 'body' && mapper.inputKey in input) {
        body[mapper.key] = input[mapper.inputKey];
        hasBody = true;
      }
    }

    return hasBody ? body : undefined;
  }

  /**
   * Execute the HTTP request
   */
  private async executeRequest(request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<unknown> {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
      }
      throw new Error(`Request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }

  /**
   * Example: Extract token from a session (custom logic)
   */
  private extractTokenFromSession(context: FrontMcpContext): string | undefined {
    // Custom logic to extract token from a session
    return context.authInfo.sessionId
      ? `session_${context.authInfo.sessionId}`
      : undefined;
  }
}

/**
 * Example usage
 */
async function main() {
  // 1. Generate tools from OpenAPI spec
  const generator = await OpenAPIToolGenerator.fromURL(
    'https://api.example.com/openapi.json',
    {
      dereference: true, // Get flat schemas without $refs
    }
  );

  const tools = await generator.generateTools({
    includeSecurityInInput: false, // Security resolved from context
  });

  // 2. Create executor
  const executor = new OpenAPIToolExecutor();

  // 3. Execute a tool with FrontMCP context
  const context: FrontMcpContext = {
    authInfo: {
      jwt: 'eyJhbGciOiJIUzI1NiIs...',
      sessionId: 'sess_123',
      payload: { userId: 123 },
    },
  };

  try {
    const result = await executor.execute(
      tools[0], // First tool
      { userId: 123, query: 'test' }, // Input parameters
      context // FrontMCP context
    );

    console.log('Success:', result);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run example
if (require.main === module) {
  main().catch(console.error);
}

/**
 * Key Points:
 *
 * 1. ✅ Works with ANY OpenAPI spec, regardless of security naming
 *    - Whether it's called "BearerAuth", "JWT", "Authorization", etc.
 *    - The SecurityResolver handles all variations
 *
 * 2. ✅ Resolves auth from FrontMCP context automatically
 *    - Maps context.authInfo.jwt to any bearer token requirement
 *    - Maps context.authInfo.apiKey to any API key requirement
 *
 * 3. ✅ Supports multiple auth sources
 *    - Context (primary)
 *    - Environment variables (fallback)
 *    - Custom resolution logic
 *
 * 4. ✅ Validates auth is available
 *    - Clear error messages if auth is missing
 *    - Tells user exactly what's needed
 *
 * 5. ✅ Separates auth from regular parameters
 *    - Security is resolved from context
 *    - Regular parameters come from input
 */
