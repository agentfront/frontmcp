/**
 * @file fixture-types.ts
 * @description Type definitions for test fixtures
 */

import type { McpTestClient } from '../client/mcp-test-client';
import type { JWK } from 'jose';

// ═══════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Configuration passed to test.use()
 */
export interface TestConfig {
  /** Server entry file path (e.g., './src/main.ts') */
  server?: string;
  /** Port to run server on (default: auto-select available port) */
  port?: number;
  /** Transport type (default: 'streamable-http') */
  transport?: 'sse' | 'streamable-http';
  /** Auth configuration for the server */
  auth?: {
    mode?: 'public' | 'orchestrated';
    type?: 'local' | 'remote';
  };
  /**
   * Enable public mode for the test client.
   * When true, no Authorization header is sent and anonymous token is not requested.
   * Use this for testing servers configured with `auth: { mode: 'public' }`.
   */
  publicMode?: boolean;
  /** Server log level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Environment variables to pass to the server */
  env?: Record<string, string>;
  /** Startup timeout in ms (default: 30000) */
  startupTimeout?: number;
  /** Base URL for connecting to an external/already running server */
  baseUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════
// FIXTURE TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Fixtures available in test functions
 */
export interface TestFixtures {
  /** Auto-connected MCP client */
  mcp: McpTestClient;
  /** Token factory for auth testing */
  auth: AuthFixture;
  /** Server control */
  server: ServerFixture;
}

/**
 * Auth fixture for creating and managing test tokens
 */
export interface AuthFixture {
  /**
   * Create a JWT token with the specified claims
   */
  createToken(options: {
    sub: string;
    scopes?: string[];
    email?: string;
    name?: string;
    claims?: Record<string, unknown>;
    expiresIn?: number;
  }): Promise<string>;

  /**
   * Create an expired token (for testing token expiration)
   */
  createExpiredToken(options: { sub: string }): Promise<string>;

  /**
   * Create a token with an invalid signature (for testing signature validation)
   */
  createInvalidToken(options: { sub: string }): string;

  /**
   * Pre-built test users with common permission sets
   */
  users: {
    admin: TestUser;
    user: TestUser;
    readOnly: TestUser;
  };

  /**
   * Get the public JWKS for verifying tokens
   */
  getJwks(): Promise<{ keys: JWK[] }>;

  /**
   * Get the issuer URL
   */
  getIssuer(): string;

  /**
   * Get the audience
   */
  getAudience(): string;
}

/**
 * Pre-defined test user
 */
export interface TestUser {
  sub: string;
  scopes: string[];
  email?: string;
  name?: string;
}

/**
 * Server fixture for controlling the test server
 */
export interface ServerFixture {
  /**
   * Server information
   */
  info: {
    baseUrl: string;
    port: number;
    pid?: number;
  };

  /**
   * Create an additional MCP client connected to this server
   */
  createClient(options?: { transport?: 'sse' | 'streamable-http'; token?: string }): Promise<McpTestClient>;

  /**
   * Restart the server
   */
  restart(): Promise<void>;

  /**
   * Get captured server logs
   */
  getLogs(): string[];

  /**
   * Clear captured server logs
   */
  clearLogs(): void;
}

// ═══════════════════════════════════════════════════════════════════
// TEST FUNCTION TYPE
// ═══════════════════════════════════════════════════════════════════

/**
 * Test function that receives fixtures
 */
export type TestFn = (fixtures: TestFixtures) => Promise<void> | void;

/**
 * Enhanced test function with fixture support
 */
export interface TestWithFixtures {
  (name: string, fn: TestFn): void;

  /** Configure fixtures for this test file/suite */
  use(config: TestConfig): void;

  /** Create a describe block */
  describe: typeof describe;

  /** Run before all tests in the file */
  beforeAll: typeof beforeAll;

  /** Run before each test */
  beforeEach: typeof beforeEach;

  /** Run after each test */
  afterEach: typeof afterEach;

  /** Run after all tests in the file */
  afterAll: typeof afterAll;

  /** Skip a test */
  skip(name: string, fn: TestFn): void;

  /** Run only this test */
  only(name: string, fn: TestFn): void;

  /** Mark test as todo (not implemented) */
  todo(name: string): void;
}
