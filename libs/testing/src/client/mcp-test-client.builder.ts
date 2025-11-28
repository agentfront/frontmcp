/**
 * @file mcp-test-client.builder.ts
 * @description Builder pattern for creating McpTestClient instances
 */

import type { McpTestClientConfig, TestTransportType, TestAuthConfig } from './mcp-test-client.types';
import { McpTestClient } from './mcp-test-client';

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
