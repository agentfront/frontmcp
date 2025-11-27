# @frontmcp/testing Architecture

This document explains how `@frontmcp/testing` works under the hood. It's intended for contributors, maintainers, and developers who want to understand or extend the library.

## Table of Contents

1. [High-Level Overview](#high-level-overview)
2. [Core Components](#core-components)
3. [Test Lifecycle](#test-lifecycle)
4. [Data Flow](#data-flow)
5. [Extension Guide](#extension-guide)
6. [Design Decisions](#design-decisions)

---

## High-Level Overview

`@frontmcp/testing` provides a Playwright-inspired fixture system for testing MCP (Model Context Protocol) servers. The key design principle is **fixture injection**: tests declare what fixtures they need, and the framework provides fully-initialized instances.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Test File                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  test.use({ server: './src/main.ts', port: 3003 })                     │ │
│  │                                                                         │ │
│  │  test('my test', async ({ mcp, auth, server }) => {                    │ │
│  │    // mcp, auth, server are auto-injected fixtures                     │ │
│  │  })                                                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Fixture System                                       │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   TestServer    │  │  TokenFactory   │  │     McpTestClient          │  │
│  │   (shared)      │  │   (shared)      │  │   (per-test)               │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Relationships

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           Entry Points                                    │
│                                                                           │
│  ┌────────────┐      ┌────────────┐      ┌────────────┐                  │
│  │  test      │      │  expect    │      │ jest-preset │                 │
│  │ (fixture)  │      │ (matchers) │      │  (config)   │                 │
│  └──────┬─────┘      └─────┬──────┘      └──────┬──────┘                 │
│         │                  │                    │                         │
└─────────┼──────────────────┼────────────────────┼─────────────────────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  src/fixtures/  │  │  src/matchers/  │  │   src/setup.ts  │
│                 │  │                 │  │                 │
│  test-fixture   │  │  mcp-matchers   │  │  registers      │
│  fixture-types  │  │  matcher-types  │  │  matchers       │
└────────┬────────┘  └─────────────────┘  └─────────────────┘
         │
         ├────────────────────┬────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  src/client/    │  │  src/server/    │  │  src/auth/      │
│                 │  │                 │  │                 │
│  McpTestClient  │  │  TestServer     │  │  TokenFactory   │
│  Builder        │  │                 │  │                 │
│  Types          │  │                 │  │                 │
└────────┬────────┘  └─────────────────┘  └─────────────────┘
         │
         ▼
┌─────────────────┐
│  src/transport/ │
│                 │
│  Streamable-HTTP│
│  (SSE planned)  │
└─────────────────┘
```

---

## Core Components

### 1. Fixture System (`src/fixtures/`)

The fixture system is the heart of the library. It manages test lifecycle and provides fixtures to tests.

#### Files

| File               | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `fixture-types.ts` | TypeScript interfaces for all fixtures and config     |
| `test-fixture.ts`  | Core fixture implementation with lifecycle management |
| `index.ts`         | Barrel exports                                        |

#### Global State Management

The fixture system uses module-level state to share expensive resources across tests:

```typescript
// src/fixtures/test-fixture.ts

/** Current test configuration (set via test.use()) */
let currentConfig: TestConfig = {};

/** Server instance (shared across tests in a file) */
let serverInstance: TestServer | null = null;

/** Token factory instance (shared across tests in a file) */
let tokenFactory: TestTokenFactory | null = null;

/** Track if server was started by us (vs external) */
let serverStartedByUs = false;
```

**Why module-level state?** Starting an MCP server is expensive (100-500ms). By sharing the server instance across all tests in a file, we avoid restarting it for each test. This dramatically improves test performance.

#### Lifecycle Functions

```typescript
// Initialize shared resources (once per test file)
async function initializeSharedResources(): Promise<void>;

// Create fixtures for a single test
async function createTestFixtures(): Promise<TestFixtures>;

// Clean up after a single test
async function cleanupTestFixtures(fixtures: TestFixtures): Promise<void>;

// Clean up after all tests in a file
async function cleanupSharedResources(): Promise<void>;
```

#### The `test.use()` Mechanism

When you call `test.use()`, two things happen:

1. Configuration is merged into `currentConfig`
2. An `afterAll` hook is registered to ensure cleanup

```typescript
function use(config: TestConfig): void {
  // Merge with existing config
  currentConfig = { ...currentConfig, ...config };

  // Register cleanup hook - ensures server stops even if tests fail
  afterAll(async () => {
    await cleanupSharedResources();
  });
}
```

**Why register afterAll in use()?** This ensures cleanup happens even if tests throw errors. The cleanup is registered once when `use()` is called, not in each test.

#### The `test()` Function

The `test()` function wraps Jest's `it()` with fixture injection:

```typescript
function testWithFixtures(name: string, fn: TestFn): void {
  it(name, async () => {
    const fixtures = await createTestFixtures();
    try {
      await fn(fixtures);
    } finally {
      await cleanupTestFixtures(fixtures);
    }
  });
}
```

The `try/finally` ensures fixture cleanup happens even if the test throws.

---

### 2. MCP Test Client (`src/client/`)

The client provides a fluent API for interacting with MCP servers.

#### Files

| File                         | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `mcp-test-client.ts`         | Main client class with all MCP operations |
| `mcp-test-client.builder.ts` | Builder pattern for client configuration  |
| `mcp-test-client.types.ts`   | TypeScript types and interfaces           |

#### Builder Pattern

The builder provides a fluent API for configuration:

```typescript
const client = await McpTestClient.create({ baseUrl: 'http://localhost:3003' })
  .withTransport('streamable-http') // Set transport
  .withToken('my-token') // Set auth token
  .withTimeout(5000) // Set timeout
  .withDebug() // Enable debug logging
  .buildAndConnect(); // Build and connect
```

Each `with*()` method returns `this`, enabling chaining. The final `buildAndConnect()` creates the client and connects.

#### Result Wrapper Pattern

Tool and resource results are wrapped in helper objects that provide a fluent API:

```typescript
interface ToolResultWrapper {
  raw: CallToolResult; // Original MCP response
  isSuccess: boolean; // Quick success check
  isError: boolean; // Quick error check
  error?: McpErrorInfo; // Error details if any
  durationMs?: number; // Request duration

  // Fluent accessors
  json<T>(): T; // Parse text content as JSON
  text(): string | undefined; // Get text content
  hasTextContent(): boolean; // Check for text
  hasImageContent(): boolean; // Check for images
  hasResourceContent(): boolean; // Check for resources
}
```

**Why wrappers?** They provide a consistent API for assertions and make test code more readable:

```typescript
// Without wrappers - verbose and error-prone
const result = await client.tools.call('my-tool', {});
const content = result.content?.find((c) => c.type === 'text');
expect(content).toBeDefined();
expect(JSON.parse(content!.text)).toHaveProperty('success', true);

// With wrappers - clean and fluent
const result = await mcp.tools.call('my-tool', {});
expect(result).toBeSuccessful();
expect(result.json()).toHaveProperty('success', true);
```

---

### 3. Custom Matchers (`src/matchers/`)

Custom Jest matchers make assertions more readable and provide better error messages.

#### Files

| File               | Purpose                                 |
| ------------------ | --------------------------------------- |
| `mcp-matchers.ts`  | Matcher implementations                 |
| `matcher-types.ts` | TypeScript declarations for type safety |
| `index.ts`         | Barrel exports                          |

#### How Jest Matchers Work

Jest matchers are functions that return `{ pass: boolean, message: () => string }`:

```typescript
const toContainTool: MatcherFunction<[toolName: string]> = function (received, toolName) {
  const tools = received as Tool[];

  // Validation
  if (!Array.isArray(tools)) {
    return {
      pass: false,
      message: () => `Expected an array of tools, but received ${typeof received}`,
    };
  }

  // Check condition
  const pass = tools.some((t) => t.name === toolName);
  const availableTools = tools.map((t) => t.name).join(', ');

  // Return result with descriptive messages for both cases
  return {
    pass,
    message: () =>
      pass
        ? `Expected tools not to contain "${toolName}"` // For .not case
        : `Expected tools to contain "${toolName}", but got: [${availableTools}]`,
  };
};
```

#### TypeScript Declaration Merging

To get type checking for custom matchers, we extend Jest's interfaces:

```typescript
// src/matchers/matcher-types.ts

export interface McpMatchers<R = unknown> {
  toContainTool(toolName: string): R;
  toBeSuccessful(): R;
  toBeError(expectedCode?: number): R;
  // ... more matchers
}

// Extend Jest's global namespace
declare global {
  namespace jest {
    interface Matchers<R> extends McpMatchers<R> {}
    interface Expect extends McpMatchers<void> {}
    interface InverseAsymmetricMatchers extends McpMatchers<void> {}
  }
}
```

This allows TypeScript to recognize custom matchers:

```typescript
expect(tools).toContainTool('my-tool'); // ✓ TypeScript knows this exists
expect(result).toBeSuccessful(); // ✓ TypeScript knows this exists
```

#### Registering Matchers

Matchers are registered in the setup file:

```typescript
// src/setup.ts
import { expect } from '@jest/globals';
import { mcpMatchers } from './matchers/mcp-matchers';

expect.extend(mcpMatchers);
```

This runs once when Jest initializes (via `setupFilesAfterEnv`).

---

### 4. Server Management (`src/server/`)

The `TestServer` class manages MCP server lifecycle for tests.

#### Two Modes

1. **Start Mode**: Spawns a new server process
2. **Connect Mode**: Connects to an existing server

```typescript
// Start a new server
const server = await TestServer.start({
  command: 'npx tsx src/main.ts',
  port: 3003,
});

// Connect to existing server
const server = TestServer.connect('http://localhost:3003');
```

#### Health Check Polling

After starting a server, we poll until it's ready:

```typescript
async waitForReady(timeout?: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${this._info.baseUrl}/health`);
      if (response.ok || response.status === 404) {
        // Server is running (404 = no health endpoint, but server responds)
        return;
      }
    } catch {
      // Not ready yet - keep polling
    }
    await sleep(100);
  }

  throw new Error(`Server did not become ready within ${timeoutMs}ms`);
}
```

#### Process Lifecycle

The server process is managed carefully:

```typescript
async stop(): Promise<void> {
  if (this.process) {
    // Try graceful shutdown first
    this.process.kill('SIGTERM');

    // Wait for exit or force kill after 5 seconds
    await Promise.race([
      exitPromise,
      new Promise(r => setTimeout(() => {
        this.process?.kill('SIGKILL');
        r();
      }, 5000))
    ]);
  }
}
```

---

### 5. Auth System (`src/auth/`)

The auth system generates JWT tokens for testing authentication flows.

#### Token Factory

`TestTokenFactory` generates real JWT tokens using the `jose` library:

```typescript
class TestTokenFactory {
  private privateKey: CryptoKeyLike | null = null;
  private publicKey: CryptoKeyLike | null = null;

  async createTestToken(options: CreateTokenOptions): Promise<string> {
    await this.ensureKeys(); // Generate RSA keypair on first use

    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: this.keyId })
      .sign(this.privateKey!);

    return token;
  }

  async getPublicJwks(): Promise<{ keys: JWK[] }> {
    // Returns the public key for verification
    return { keys: [this.jwk!] };
  }
}
```

#### Key Features

1. **Lazy Key Generation**: Keys are generated on first use
2. **Real JWTs**: Tokens are valid JWTs that can be verified
3. **JWKS Endpoint**: Public keys can be exposed for server verification
4. **Test Tokens**: `createExpiredToken()`, `createInvalidToken()` for edge cases

---

### 6. Interceptor System (`src/interceptor/`)

The interceptor system allows mocking and intercepting MCP requests/responses for testing.

#### Files

| File                   | Purpose                                          |
| ---------------------- | ------------------------------------------------ |
| `interceptor.types.ts` | TypeScript interfaces for interceptors and mocks |
| `interceptor-chain.ts` | Core interceptor chain implementation            |
| `mock-registry.ts`     | Mock registry and response helpers               |
| `index.ts`             | Barrel exports                                   |

#### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Request Flow                                      │
│                                                                          │
│  mcp.tools.call()                                                        │
│        │                                                                 │
│        ▼                                                                 │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐             │
│  │ Check Mocks  │────▶│ Run Request  │────▶│ Send to      │             │
│  │              │     │ Interceptors │     │ Server       │             │
│  └──────┬───────┘     └──────────────┘     └──────┬───────┘             │
│         │                                         │                      │
│         │ (if mock matches)                       ▼                      │
│         │                              ┌──────────────┐                  │
│         │                              │ Run Response │                  │
│         └─────────────────────────────▶│ Interceptors │                  │
│                                        └──────┬───────┘                  │
│                                               │                          │
│                                               ▼                          │
│                                        Return Response                   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Mock Registry

The mock registry matches requests against registered mocks:

```typescript
// Register a mock
const handle = mcp.mock.add({
  method: 'tools/call',
  params: { name: 'my-tool' }, // Match specific params
  response: mockResponse.toolResult([{ type: 'text', text: 'mocked!' }]),
  times: 1, // Only match once (optional)
  delay: 100, // Simulate latency (optional)
});

// Convenience methods
mcp.mock.tool('my-tool', { result: 'mocked' });
mcp.mock.resource('file://readme', 'Hello World');
mcp.mock.toolError('broken-tool', -32603, 'Internal error');

// Track calls
console.log(handle.callCount()); // 1
console.log(handle.calls()); // [{ method: 'tools/call', params: {...} }]

// Cleanup
handle.remove();
mcp.mock.clear();
```

#### Request Interceptors

Interceptors can modify, mock, or fail requests:

```typescript
// Log all requests
mcp.intercept.request((ctx) => {
  console.log(`${ctx.request.method}`, ctx.request.params);
  return { action: 'passthrough' };
});

// Modify requests
mcp.intercept.request((ctx) => {
  if (ctx.request.method === 'tools/call') {
    return {
      action: 'modify',
      request: {
        ...ctx.request,
        params: { ...ctx.request.params, injected: true },
      },
    };
  }
  return { action: 'passthrough' };
});

// Return mock response
mcp.intercept.request((ctx) => {
  if (ctx.request.method === 'tools/list') {
    return {
      action: 'mock',
      response: { jsonrpc: '2.0', id: ctx.request.id, result: { tools: [] } },
    };
  }
  return { action: 'passthrough' };
});

// Fail specific requests
mcp.intercept.request((ctx) => {
  if (ctx.meta.sessionId === undefined) {
    return { action: 'error', error: new Error('No session') };
  }
  return { action: 'passthrough' };
});
```

#### Response Interceptors

Response interceptors can modify responses after they're received:

```typescript
mcp.intercept.response((ctx) => {
  // Log all responses
  console.log(`${ctx.request.method} took ${ctx.durationMs}ms`);

  // Modify response
  if (ctx.request.method === 'tools/list') {
    return {
      action: 'modify',
      response: {
        ...ctx.response,
        result: { tools: [...ctx.response.result.tools, extraTool] },
      },
    };
  }

  return { action: 'passthrough' };
});
```

#### Convenience Helpers

```typescript
// Add latency to all requests
mcp.intercept.delay(100);

// Fail a specific method
mcp.intercept.failMethod('resources/read', 'Simulated failure');

// Clear interceptors
mcp.intercept.clear();

// Clear everything (interceptors + mocks)
mcp.intercept.clearAll();
```

#### mockResponse Helper

Pre-built response creators for common scenarios:

```typescript
import { mockResponse } from '@frontmcp/testing';

// Success responses
mockResponse.success({ data: 'result' });
mockResponse.toolResult([{ type: 'text', text: 'Hello' }]);
mockResponse.toolsList([{ name: 'tool1' }, { name: 'tool2' }]);
mockResponse.resourcesList([{ uri: 'file://a' }]);
mockResponse.resourceRead([{ uri: 'file://a', text: 'content' }]);

// Error responses
mockResponse.error(-32603, 'Internal error');
mockResponse.errors.methodNotFound('unknown');
mockResponse.errors.resourceNotFound('file://missing');
mockResponse.errors.unauthorized();
```

---

### 7. HTTP Mocking (`src/http-mock/`)

The HTTP mocking system intercepts `fetch()` calls made by tools, enabling fully offline testing of MCP servers.

#### Files

| File                 | Purpose                          |
| -------------------- | -------------------------------- |
| `http-mock.types.ts` | TypeScript interfaces            |
| `http-mock.ts`       | Fetch interceptor implementation |
| `index.ts`           | Barrel exports                   |

#### Why HTTP Mocking?

MCP tools often make HTTP requests to external APIs:

```typescript
@Tool({ name: 'fetch-weather' })
async getWeather(ctx: ToolContext<{ city: string }>) {
  // This fetch call needs to be mocked for offline testing
  const response = await fetch(`https://api.weather.com/${ctx.input.city}`);
  const data = await response.json();
  return ctx.text(`Weather: ${data.temperature}°F`);
}
```

Without HTTP mocking, tests would fail offline or make real API calls.

#### Basic Usage

```typescript
import { httpMock, httpResponse } from '@frontmcp/testing';

// Create an HTTP interceptor
const interceptor = httpMock.interceptor();

// Mock a GET request
interceptor.get('https://api.weather.com/london', {
  temperature: 72,
  conditions: 'sunny',
});

// Run your test
const result = await mcp.tools.call('fetch-weather', { city: 'london' });
expect(result).toBeSuccessful();
expect(result.text()).toContain('72');

// Verify all mocks were used
interceptor.assertDone();

// Clean up
interceptor.restore();
```

#### URL Matching

```typescript
// Exact URL match
interceptor.get('https://api.example.com/users/1', { id: 1 });

// Pattern matching with RegExp
interceptor.get(/api\.example\.com\/users\/\d+/, { id: 1 });

// Custom matcher function
interceptor.mock({
  match: {
    url: (url) => url.startsWith('https://api.'),
    method: 'GET',
  },
  response: { body: { success: true } },
});
```

#### Request Matching

```typescript
// Match by method
interceptor.post('https://api.example.com/users', { id: 2 });

// Match by headers
interceptor.mock({
  match: {
    url: 'https://api.example.com/auth',
    headers: {
      authorization: /^Bearer /,
    },
  },
  response: { body: { authenticated: true } },
});

// Match by body
interceptor.mock({
  match: {
    url: 'https://api.example.com/users',
    method: 'POST',
    body: { name: 'John' }, // Partial match
  },
  response: { status: 201, body: { id: 1, name: 'John' } },
});
```

#### Response Helpers

```typescript
import { httpResponse } from '@frontmcp/testing';

// JSON response
interceptor.get('/api/data', httpResponse.json({ id: 1 }));

// Text response
interceptor.get('/api/text', httpResponse.text('Hello World'));

// Error responses
interceptor.get('/api/missing', httpResponse.notFound());
interceptor.get('/api/error', httpResponse.serverError('Database down'));
interceptor.get('/api/auth', httpResponse.unauthorized());

// Delayed response (simulate latency)
interceptor.get('/api/slow', httpResponse.delayed({ data: 'result' }, 500));
```

#### Tracking Calls

```typescript
const handle = interceptor.get('https://api.example.com/users', []);

// Run tests...
await mcp.tools.call('list-users', {});

// Check how many times the mock was called
console.log(handle.callCount()); // 1

// Get all intercepted requests
const calls = handle.calls();
console.log(calls[0].headers); // Request headers
console.log(calls[0].body); // Request body

// Wait for a specific number of calls
await handle.waitForCalls(3, 5000); // Wait up to 5s for 3 calls
```

#### One-Time Mocks

```typescript
// Only match once (useful for testing retries)
interceptor.mock({
  match: { url: '/api/flaky' },
  response: httpResponse.serverError(),
  times: 1,
});

// Second call will use this mock
interceptor.mock({
  match: { url: '/api/flaky' },
  response: { body: { success: true } },
});
```

#### Passthrough Mode

```typescript
// Allow unmatched requests to go through to the real network
interceptor.allowPassthrough(true);

// Now only matched requests are mocked, others hit the real API
interceptor.get('/api/mocked', { mocked: true });
```

#### Cleanup

```typescript
// Remove specific mock
const handle = interceptor.get('/api/users', []);
handle.remove();

// Clear all mocks in interceptor
interceptor.clear();

// Restore original fetch (important!)
interceptor.restore();

// Or disable all HTTP mocking globally
httpMock.disable();
```

---

## Test Lifecycle

Here's what happens when you run a test file:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  1. FILE LOAD                                                              │
│     - test.use() is called                                                 │
│     - Configuration is stored in currentConfig                             │
│     - afterAll cleanup hook is registered                                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  2. FIRST TEST STARTS                                                      │
│     - initializeSharedResources() is called                                │
│     - TokenFactory is created                                              │
│     - Server is started (or connected to)                                  │
│     - Health check polling until ready                                     │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  3. EACH TEST                                                              │
│     a. createTestFixtures() creates:                                       │
│        - New McpTestClient (connects to shared server)                     │
│        - AuthFixture (wraps shared TokenFactory)                           │
│        - ServerFixture (wraps shared server)                               │
│                                                                            │
│     b. Test function runs with fixtures                                    │
│                                                                            │
│     c. cleanupTestFixtures() runs:                                         │
│        - Client disconnects                                                │
│        - (Server stays running for next test)                              │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  4. AFTER ALL TESTS                                                        │
│     - cleanupSharedResources() runs (via afterAll hook)                    │
│     - Server is stopped (if we started it)                                 │
│     - Module state is cleared                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### Test Execution Flow

```
test('my test', async ({ mcp }) => { ... })
                         │
                         ▼
              ┌──────────────────────┐
              │  createTestFixtures  │
              └──────────┬───────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│ TokenFactory  │ │  TestServer   │ │ McpTestClient │
│   (shared)    │ │   (shared)    │ │  (per-test)   │
└───────┬───────┘ └───────┬───────┘ └───────┬───────┘
        │                 │                 │
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  AuthFixture  │ │ ServerFixture │ │   mcp client  │
│   (wrapper)   │ │   (wrapper)   │ │  (connected)  │
└───────────────┘ └───────────────┘ └───────────────┘
        │                 │                 │
        └────────────────┬┘─────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │    TestFixtures      │
              │  { mcp, auth, server}│
              └──────────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │   Test Function      │
              └──────────────────────┘
```

### MCP Request Flow

```
mcp.tools.call('my-tool', { arg: 'value' })
                    │
                    ▼
         ┌──────────────────────┐
         │   McpTestClient      │
         │   tools.call()       │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  request() method    │
         │  - Builds JSON-RPC   │
         │  - Tracks timing     │
         │  - Updates session   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  McpTransport        │
         │  (StreamableHTTP)    │
         └──────────┬───────────┘
                    │
         ┌──────────▼───────────┐
         │  HTTP POST request   │
         │  to /mcp endpoint    │
         └──────────┬───────────┘
                    │
         ┌──────────▼───────────┐
         │  MCP Server          │
         │  (your server)       │
         └──────────┬───────────┘
                    │
         ┌──────────▼───────────┐
         │  JSON-RPC response   │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  wrapToolResult()    │
         │  - Wraps response    │
         │  - Adds helpers      │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  ToolResultWrapper   │
         │  .json(), .text()    │
         │  .isSuccess, etc.    │
         └──────────────────────┘
```

---

## Extension Guide

### Adding New Fixtures

1. **Define the type** in `fixture-types.ts`:

```typescript
export interface MyFixture {
  doSomething(): Promise<void>;
  getValue(): string;
}

// Add to TestFixtures
export interface TestFixtures {
  mcp: McpTestClient;
  auth: AuthFixture;
  server: ServerFixture;
  myFixture: MyFixture; // Add here
}
```

2. **Create the fixture factory** in `test-fixture.ts`:

```typescript
function createMyFixture(): MyFixture {
  return {
    async doSomething() {
      // Implementation
    },
    getValue() {
      return 'value';
    },
  };
}
```

3. **Add to `createTestFixtures()`**:

```typescript
async function createTestFixtures(): Promise<TestFixtures> {
  await initializeSharedResources();

  return {
    mcp: clientInstance,
    auth: createAuthFixture(tokenFactory!),
    server: createServerFixture(serverInstance!),
    myFixture: createMyFixture(), // Add here
  };
}
```

### Adding New Matchers

1. **Implement the matcher** in `mcp-matchers.ts`:

```typescript
const toHaveProperty: MatcherFunction<[name: string, value?: unknown]> = function (received, name, value) {
  const obj = received as Record<string, unknown>;

  const hasProperty = name in obj;
  const valueMatches = value === undefined || obj[name] === value;
  const pass = hasProperty && valueMatches;

  return {
    pass,
    message: () =>
      pass
        ? `Expected object not to have property "${name}"`
        : `Expected object to have property "${name}" with value ${value}`,
  };
};

// Add to exports
export const mcpMatchers = {
  // ... existing matchers
  toHaveProperty,
};
```

2. **Add TypeScript declaration** in `matcher-types.ts`:

```typescript
export interface McpMatchers<R = unknown> {
  // ... existing matchers
  toHaveProperty(name: string, value?: unknown): R;
}
```

### Adding New Transport Types

1. **Implement the interface** in `transport/`:

```typescript
// src/transport/sse.transport.ts
import type { McpTransport, TransportConfig } from './transport.interface';

export class SseTransport implements McpTransport {
  constructor(config: TransportConfig) {
    // ...
  }

  async connect(): Promise<void> {
    // SSE connection logic
  }

  async request<T>(message: JSONRPCRequest): Promise<JSONRPCResponse<T>> {
    // SSE request logic
  }

  // ... other methods
}
```

2. **Register in client** in `mcp-test-client.ts`:

```typescript
private createTransport(): McpTransport {
  switch (this.config.transport) {
    case 'streamable-http':
      return new StreamableHttpTransport(/* ... */);
    case 'sse':
      return new SseTransport(/* ... */);  // Add new transport
    default:
      throw new Error(`Unknown transport: ${this.config.transport}`);
  }
}
```

3. **Update types** in `mcp-test-client.types.ts`:

```typescript
export type TestTransportType = 'streamable-http' | 'sse';
```

---

## Design Decisions

### Why Module-Level State?

**Problem**: Starting an MCP server is expensive (spawning process, waiting for ready).

**Solution**: Share the server instance across all tests in a file.

**Trade-off**: Tests in the same file share state. If a test corrupts server state, it affects subsequent tests. However, in practice this is rare and the performance benefit outweighs the risk.

### Why afterAll in use()?

**Problem**: If a test throws, cleanup code after the test won't run.

**Solution**: Register cleanup in `afterAll()` which Jest guarantees to run.

**Alternative considered**: Cleanup in `afterEach()`. Rejected because it would stop/restart the server between every test, losing the performance benefit of sharing.

### Why Wrapper Classes?

**Problem**: MCP responses have complex nested structures that are verbose to access.

**Solution**: Wrap responses in helper objects with convenient methods.

**Benefits**:

- Cleaner test code (`result.json()` vs `JSON.parse(result.content[0].text)`)
- Consistent API across different result types
- Better TypeScript inference

### Why TypeScript Declaration Merging?

**Problem**: Custom Jest matchers lose type checking.

**Solution**: Extend Jest's interfaces using TypeScript declaration merging.

**Alternative considered**: Custom `expect` wrapper. Rejected because it would break IDE integration and require learning a new API.

### Why Builder Pattern for Client?

**Problem**: McpTestClient has many configuration options.

**Solution**: Builder pattern allows fluent configuration without complex constructors.

**Benefits**:

- Clear API: `.withToken()`, `.withTimeout()`, etc.
- Optional configuration: only set what you need
- IDE autocomplete shows all options

---

## File Reference

```
libs/testing/
├── src/
│   ├── index.ts                    # Main barrel exports
│   ├── setup.ts                    # Jest setup (registers matchers)
│   │
│   ├── fixtures/
│   │   ├── index.ts                # Fixture exports
│   │   ├── fixture-types.ts        # TypeScript interfaces
│   │   └── test-fixture.ts         # Core fixture implementation
│   │
│   ├── client/
│   │   ├── mcp-test-client.ts      # Main client class
│   │   ├── mcp-test-client.builder.ts  # Builder pattern
│   │   └── mcp-test-client.types.ts    # Client types
│   │
│   ├── matchers/
│   │   ├── index.ts                # Matcher exports
│   │   ├── mcp-matchers.ts         # Matcher implementations
│   │   └── matcher-types.ts        # TypeScript declarations
│   │
│   ├── server/
│   │   └── test-server.ts          # Server lifecycle management
│   │
│   ├── auth/
│   │   ├── token-factory.ts        # JWT generation
│   │   ├── auth-headers.ts         # Auth header utilities
│   │   └── user-fixtures.ts        # Pre-built test users
│   │
│   ├── transport/
│   │   ├── transport.interface.ts  # Transport abstraction
│   │   └── streamable-http.transport.ts  # HTTP transport
│   │
│   ├── interceptor/
│   │   ├── index.ts                # Interceptor exports
│   │   ├── interceptor.types.ts    # TypeScript interfaces
│   │   ├── interceptor-chain.ts    # Core interceptor chain
│   │   └── mock-registry.ts        # Mock registry and helpers
│   │
│   ├── http-mock/
│   │   ├── index.ts                # HTTP mock exports
│   │   ├── http-mock.types.ts      # TypeScript interfaces
│   │   └── http-mock.ts            # Fetch interceptor implementation
│   │
│   ├── assertions/
│   │   └── mcp-assertions.ts       # Functional assertions
│   │
│   └── errors/
│       └── index.ts                # Custom error classes
│
├── jest-preset.js                  # Jest preset configuration
├── package.json                    # Package manifest
└── ARCHITECTURE.md                 # This file
```
