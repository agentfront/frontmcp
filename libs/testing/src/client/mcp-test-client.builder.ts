/**
 * @file mcp-test-client.builder.ts
 * @description Builder pattern for creating McpTestClient instances
 */

import type {
  McpTestClientConfig,
  TestTransportType,
  TestAuthConfig,
  TestClientCapabilities,
} from './mcp-test-client.types';
import { McpTestClient } from './mcp-test-client';
import type { TestPlatformType } from '../platform/platform-types';
import { getPlatformClientInfo, getPlatformCapabilities } from '../platform/platform-client-info';

/**
 * Builder for creating McpTestClient instances with fluent API
 *
 * @example
 * ```typescript
 * const client = await McpTestClient.create({ baseUrl: 'http://localhost:3003' })
 *   .withTransport('streamable-http')
 *   .withToken('my-jwt-token')
 *   .withTimeout(5000)
 *   .withDebug()
 *   .buildAndConnect();
 * ```
 */
export class McpTestClientBuilder {
  private config: McpTestClientConfig;

  constructor(config: McpTestClientConfig) {
    this.config = { ...config };
  }

  /**
   * Set the authentication configuration
   */
  withAuth(auth: TestAuthConfig): this {
    this.config.auth = { ...this.config.auth, ...auth };
    return this;
  }

  /**
   * Set the bearer token for authentication
   */
  withToken(token: string): this {
    this.config.auth = { ...this.config.auth, token };
    return this;
  }

  /**
   * Add custom headers to all requests
   */
  withHeaders(headers: Record<string, string>): this {
    this.config.auth = {
      ...this.config.auth,
      headers: { ...this.config.auth?.headers, ...headers },
    };
    return this;
  }

  /**
   * Set the transport type
   */
  withTransport(transport: TestTransportType): this {
    this.config.transport = transport;
    return this;
  }

  /**
   * Set the request timeout in milliseconds
   */
  withTimeout(timeoutMs: number): this {
    this.config.timeout = timeoutMs;
    return this;
  }

  /**
   * Enable debug logging
   */
  withDebug(enabled = true): this {
    this.config.debug = enabled;
    return this;
  }

  /**
   * Enable public mode - skip authentication entirely.
   * When true, no Authorization header is sent and anonymous token is not requested.
   * Use this for testing public/unauthenticated endpoints in CI/CD pipelines.
   */
  withPublicMode(enabled = true): this {
    this.config.publicMode = enabled;
    return this;
  }

  /**
   * Set the MCP protocol version to request
   */
  withProtocolVersion(version: string): this {
    this.config.protocolVersion = version;
    return this;
  }

  /**
   * Set the client info sent during initialization
   */
  withClientInfo(info: { name: string; version: string }): this {
    this.config.clientInfo = info;
    return this;
  }

  /**
   * Set the platform type for testing platform-specific meta keys.
   * Automatically configures clientInfo and capabilities for platform detection.
   *
   * Platform-specific behavior:
   * - `openai`: Uses openai/* meta keys, sets User-Agent to "ChatGPT/1.0"
   * - `ext-apps`: Uses ui/* meta keys per SEP-1865, sets io.modelcontextprotocol/ui capability
   * - `claude`: Uses frontmcp/* + ui/* keys, sets User-Agent to "claude-desktop/1.0"
   * - `cursor`: Uses frontmcp/* + ui/* keys, sets User-Agent to "cursor/1.0"
   * - Other platforms follow similar patterns
   *
   * @example
   * ```typescript
   * const client = await McpTestClient.create({ baseUrl })
   *   .withPlatform('openai')
   *   .buildAndConnect();
   *
   * // ext-apps automatically sets the io.modelcontextprotocol/ui capability
   * const extAppsClient = await McpTestClient.create({ baseUrl })
   *   .withPlatform('ext-apps')
   *   .buildAndConnect();
   * ```
   */
  withPlatform(platform: TestPlatformType): this {
    this.config.platform = platform;
    // Auto-set clientInfo based on platform for User-Agent detection
    this.config.clientInfo = getPlatformClientInfo(platform);
    // Auto-set capabilities based on platform (ext-apps requires io.modelcontextprotocol/ui)
    this.config.capabilities = getPlatformCapabilities(platform);
    return this;
  }

  /**
   * Set custom client capabilities for MCP initialization.
   * Use this for fine-grained control over capabilities sent during initialization.
   *
   * @example
   * ```typescript
   * const client = await McpTestClient.create({ baseUrl })
   *   .withCapabilities({
   *     sampling: {},
   *     experimental: {
   *       'io.modelcontextprotocol/ui': { mimeTypes: ['text/html+mcp'] }
   *     }
   *   })
   *   .buildAndConnect();
   * ```
   */
  withCapabilities(capabilities: TestClientCapabilities): this {
    this.config.capabilities = capabilities;
    return this;
  }

  /**
   * Set query parameters to append to the connection URL.
   * Useful for testing mode switches like `?mode=skills_only`.
   *
   * @example
   * ```typescript
   * const client = await McpTestClient.create({ baseUrl })
   *   .withQueryParams({ mode: 'skills_only' })
   *   .buildAndConnect();
   * ```
   */
  withQueryParams(params: Record<string, string>): this {
    this.config.queryParams = { ...this.config.queryParams, ...params };
    return this;
  }

  /**
   * Build the McpTestClient instance (does not connect)
   */
  build(): McpTestClient {
    return new McpTestClient(this.config);
  }

  /**
   * Build the McpTestClient and connect to the server
   */
  async buildAndConnect(): Promise<McpTestClient> {
    const client = this.build();
    await client.connect();
    return client;
  }
}
