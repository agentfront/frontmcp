/// <reference types="jest" />
/**
 * Flow Test Fixtures
 *
 * Generic utilities for testing flows, including mock scope entries,
 * HTTP request/response mocks, and flow execution helpers.
 */

import 'reflect-metadata';
import { FlowControl, FlowMetadata, ScopeEntry, FrontMcpLogger, FrontMcpAuth } from '../../common';
import { InMemoryAuthorizationStore, type AuthorizationStore } from '@frontmcp/auth';

// ============================================
// Types
// ============================================

/**
 * Auth configuration for mock scope
 */
export interface MockAuthConfig {
  mode: 'public' | 'orchestrated';
  type?: 'local' | 'remote';
  consent?: { enabled: boolean };
  remote?: { provider: string };
}

/**
 * App configuration for mock scope
 */
export interface MockAppConfig {
  id: string;
  name: string;
  description?: string;
  auth?: {
    mode: string;
    remote?: { provider: string };
  };
}

/**
 * Tool configuration for mock scope
 */
export interface MockToolConfig {
  id: string;
  name: string;
  description?: string;
}

/**
 * Options for creating a mock scope entry
 */
export interface MockScopeOptions {
  id?: string;
  auth?: MockAuthConfig;
  apps?: MockAppConfig[];
  tools?: MockToolConfig[];
  port?: number;
}

/**
 * Mock HTTP request configuration
 */
export interface MockHttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Result from running flow stages
 */
export interface FlowStageResult {
  output: any;
  error: FlowControl | Error | undefined;
  state: Record<string, any>;
}

// ============================================
// Mock Factories
// ============================================

/**
 * Creates a mock FrontMcpLogger for testing
 */
export function createMockLogger(): FrontMcpLogger {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  } as unknown as FrontMcpLogger;
}

/**
 * Creates a mock authorization store for testing
 */
export function createMockAuthorizationStore(): AuthorizationStore {
  return new InMemoryAuthorizationStore();
}

/**
 * Creates a mock FrontMcpAuth for testing
 */
export function createMockAuth(options?: MockAuthConfig): FrontMcpAuth {
  const store = createMockAuthorizationStore();

  return {
    authorizationStore: store,
    options: options || { mode: 'public' },
    ready: Promise.resolve(),
  } as unknown as FrontMcpAuth;
}

/**
 * Creates a mock scope entry for testing flows
 *
 * @example
 * ```typescript
 * const scope = createMockScopeEntry({
 *   auth: { mode: 'orchestrated', type: 'local' },
 *   apps: [{ id: 'slack', name: 'Slack' }],
 *   tools: [{ id: 'slack:send', name: 'Send Message' }],
 * });
 * ```
 */
export function createMockScopeEntry(options: MockScopeOptions = {}): ScopeEntry {
  const logger = createMockLogger();
  const mockAuth = createMockAuth(options.auth);

  const apps = (options.apps || []).map((app) => ({
    metadata: {
      id: app.id,
      name: app.name,
      description: app.description,
      auth: app.auth,
    },
  }));

  const tools = (options.tools || []).map((tool) => ({
    metadata: {
      id: tool.id,
      name: tool.name,
      description: tool.description,
    },
  }));

  return {
    id: options.id || 'test-scope',
    entryPath: '',
    routeBase: '',
    fullPath: '',
    logger,
    metadata: {
      id: options.id || 'test-scope',
      http: { port: options.port || 3001 },
      auth: options.auth,
    },
    auth: mockAuth,
    apps: {
      getApps: () => apps,
      getApp: (id: string) => apps.find((a) => a.metadata.id === id),
    },
    tools: {
      getTools: () => tools,
      getTool: (id: string) => tools.find((t) => t.metadata.id === id),
    },
    providers: {
      get: jest.fn(),
    },
    hooks: {
      registerHooks: jest.fn().mockResolvedValue(undefined),
      getHooks: jest.fn().mockReturnValue([]),
      getFlowHooksForOwner: jest.fn().mockReturnValue([]),
    },
    authProviders: {
      getPrimary: () => mockAuth,
    },
    registryFlows: jest.fn(),
    runFlow: jest.fn(),
  } as unknown as ScopeEntry;
}

/**
 * Creates a mock HTTP request object
 *
 * @example
 * ```typescript
 * const request = createMockHttpRequest({
 *   method: 'GET',
 *   path: '/oauth/authorize',
 *   query: { response_type: 'code', client_id: 'test' },
 * });
 * ```
 */
export function createMockHttpRequest(options: MockHttpRequestOptions = {}) {
  const query = options.query || {};
  const queryString = Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : '';

  return {
    request: {
      method: options.method || 'GET',
      url: `${options.path || '/'}${queryString}`,
      path: options.path || '/',
      query,
      headers: options.headers || {},
      body: options.body || null,
    },
    response: {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      end: jest.fn(),
      write: jest.fn(),
      json: jest.fn(),
    },
    next: jest.fn(),
  };
}

/**
 * Creates a mock HTTP response object
 */
export function createMockHttpResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body = '';

  const response = {
    status: jest.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
      return response;
    }),
    getHeader: jest.fn((name: string) => headers[name]),
    end: jest.fn((data?: string) => {
      body = data || '';
    }),
    write: jest.fn((data: string) => {
      body += data;
    }),
    json: jest.fn((data: any) => {
      body = JSON.stringify(data);
    }),
    getStatusCode: () => statusCode,
    getBody: () => body,
    getHeaders: () => ({ ...headers }),
  };

  return response;
}

// ============================================
// Flow Execution Helpers
// ============================================

/**
 * Runs flow stages and captures the result
 *
 * This helper executes flow stage methods directly and captures
 * FlowControl exceptions (respond, fail, abort) as results.
 *
 * @example
 * ```typescript
 * const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());
 * const { output, error, state } = await runFlowStages(flow, [
 *   'parseInput',
 *   'validateInput',
 * ]);
 *
 * expect(output?.kind).toBe('redirect');
 * ```
 */
export async function runFlowStages(flow: any, stages: string[]): Promise<FlowStageResult> {
  let output: any = undefined;
  let error: FlowControl | Error | undefined = undefined;

  for (const stage of stages) {
    try {
      await flow[stage]();
    } catch (e) {
      if (e instanceof FlowControl) {
        if (e.type === 'respond') {
          output = e.output;
          break;
        }
        error = e;
        break;
      }
      throw e;
    }
  }

  // Capture final state if available
  const state = flow.state?.snapshot?.() || {};

  return { output, error, state };
}

/**
 * Runs a single flow stage and returns the result
 */
export async function runFlowStage(flow: any, stage: string): Promise<FlowStageResult> {
  return runFlowStages(flow, [stage]);
}

/**
 * Asserts that a flow stage responds with a specific output type
 */
export async function expectFlowToRespond(flow: any, stages: string[], expectedKind: string): Promise<any> {
  const { output, error } = await runFlowStages(flow, stages);

  if (error) {
    throw new Error(`Expected flow to respond with '${expectedKind}' but got error: ${error}`);
  }

  if (!output) {
    throw new Error(`Expected flow to respond with '${expectedKind}' but got no output`);
  }

  expect(output.kind).toBe(expectedKind);
  return output;
}

/**
 * Asserts that a flow stage fails with a specific error type
 */
export async function expectFlowToFail(flow: any, stages: string[]): Promise<FlowControl> {
  const { output, error } = await runFlowStages(flow, stages);

  if (output) {
    throw new Error(`Expected flow to fail but got output: ${JSON.stringify(output)}`);
  }

  if (!error || !(error instanceof FlowControl) || error.type !== 'fail') {
    throw new Error(`Expected flow to fail but got: ${error}`);
  }

  return error;
}

// ============================================
// Common Test Patterns
// ============================================

/**
 * Creates a basic flow test setup
 *
 * @example
 * ```typescript
 * const { scope, metadata, createInput } = createFlowTestSetup('oauth:authorize');
 *
 * it('should handle valid request', async () => {
 *   const input = createInput({ query: { redirect_uri: 'https://example.com' } });
 *   const flow = new OauthAuthorizeFlow(metadata, input, scope, jest.fn(), new Map());
 *   // ...
 * });
 * ```
 */
export function createFlowTestSetup<Name extends string>(flowName: Name, scopeOptions: MockScopeOptions = {}) {
  const scope = createMockScopeEntry(scopeOptions);

  const metadata = {
    name: flowName,
    plan: {
      pre: [],
      execute: [],
      post: [],
    },
    access: 'public',
  } as unknown as FlowMetadata<any>;

  const createInput = (options: MockHttpRequestOptions = {}) => {
    return createMockHttpRequest(options);
  };

  return { scope, metadata, createInput };
}

/**
 * Test helper that creates common OAuth flow scenarios
 */
export const flowScenarios = {
  /**
   * Anonymous/no-auth mode scenario
   */
  anonymous: () => createMockScopeEntry({}),

  /**
   * Orchestrated local auth scenario
   */
  orchestratedLocal: () =>
    createMockScopeEntry({
      auth: { mode: 'orchestrated', type: 'local' },
    }),

  /**
   * Orchestrated with consent enabled
   */
  withConsent: () =>
    createMockScopeEntry({
      auth: { mode: 'orchestrated', type: 'local', consent: { enabled: true } },
      tools: [
        { id: 'tool1', name: 'Tool 1' },
        { id: 'tool2', name: 'Tool 2' },
      ],
    }),

  /**
   * Multi-app scenario (potential federated login)
   */
  multiApp: () =>
    createMockScopeEntry({
      auth: { mode: 'orchestrated', type: 'local' },
      apps: [
        {
          id: 'google',
          name: 'Google',
          auth: { mode: 'transparent', remote: { provider: 'https://accounts.google.com' } },
        },
        { id: 'github', name: 'GitHub', auth: { mode: 'transparent', remote: { provider: 'https://github.com' } } },
      ],
    }),

  /**
   * Single app incremental auth scenario
   */
  incrementalAuth: (appId = 'slack') =>
    createMockScopeEntry({
      auth: { mode: 'orchestrated', type: 'local' },
      apps: [{ id: appId, name: appId.charAt(0).toUpperCase() + appId.slice(1) }],
    }),
};
