# @frontmcp/testing

> **E2E Testing Framework for FrontMCP Servers**
>
> The official testing library for FrontMCP - providing a complete toolkit for end-to-end testing of MCP servers including tools, resources, prompts, authentication, plugins, adapters, and the full MCP protocol.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [Test Runner](#test-runner)
  - [MCP Client Fixture](#mcp-client-fixture)
  - [Server Fixture](#server-fixture)
  - [Auth Fixture](#auth-fixture)
  - [Custom Matchers](#custom-matchers)
- [Testing Guide](#testing-guide)
  - [Tools](#testing-tools)
  - [Resources](#testing-resources)
  - [Prompts](#testing-prompts)
  - [Authentication](#testing-authentication)
  - [Transports](#testing-transports)
  - [Notifications](#testing-notifications)
  - [Logging & Debugging](#logging--debugging)
  - [Plugins](#testing-plugins)
  - [Adapters](#testing-adapters)
  - [Raw Protocol](#raw-protocol-access)
- [Configuration](#configuration)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
# npm
npm install -D @frontmcp/testing

# yarn
yarn add -D @frontmcp/testing

# pnpm
pnpm add -D @frontmcp/testing
```

### Peer Dependencies

```json
{
  "peerDependencies": {
    "@frontmcp/sdk": "^0.4.0",
    "jest": "^29.0.0",
    "@jest/globals": "^29.0.0",
    "@playwright/test": "^1.40.0"
  }
}
```

> **Note:** `@playwright/test` is optional - only needed for browser-based OAuth flow testing. `jest` and `@jest/globals` are optional if using a different test runner.

---

## Quick Start

### 1. Create your first test

```typescript
// my-server.e2e.ts
import { test, expect } from '@frontmcp/testing';
import MyServer from './src/main';

// Pass your FrontMCP server class
test.use({ server: MyServer });

test('server exposes tools', async ({ mcp }) => {
  const tools = await mcp.tools.list();
  expect(tools).toContainTool('my-tool');
});

test('tool execution works', async ({ mcp }) => {
  const result = await mcp.tools.call('my-tool', { input: 'test' });
  expect(result).toBeSuccessful();
});
```

### 2. Run tests

```bash
# Using frontmcp CLI
npx frontmcp test

# Using nx
nx e2e my-app

# Using jest directly
jest --config jest.e2e.config.ts
```

That's it! The library handles:

- Starting your server on an available port
- Connecting an MCP client
- Running your tests
- Cleanup after tests complete

---

## Core Concepts

### Fixtures

`@frontmcp/testing` provides several fixtures that are automatically available in your tests:

| Fixture  | Description                                   |
| -------- | --------------------------------------------- |
| `mcp`    | Auto-connected MCP client for making requests |
| `server` | Server instance with control methods          |
| `auth`   | Token factory for authentication testing      |

### Test Configuration

Configure tests using `test.use()`:

```typescript
test.use({
  server: MyServer, // Required: Your FrontMCP server class
  port: 3003, // Optional: Specific port (default: auto)
  transport: 'streamable-http', // Optional: 'sse' | 'streamable-http'
  auth: { mode: 'public' }, // Optional: Override auth config
  logLevel: 'debug', // Optional: Server log level
  env: { API_KEY: 'test' }, // Optional: Environment variables
});
```

---

## API Reference

### Test Runner

```typescript
import { test, expect } from '@frontmcp/testing';

// Define test suite
test.describe('My Feature', () => {
  // Configure for this suite
  test.use({ server: MyServer });

  // Setup/teardown
  test.beforeAll(async ({ server }) => {
    /* ... */
  });
  test.beforeEach(async ({ mcp }) => {
    /* ... */
  });
  test.afterEach(async ({ mcp }) => {
    /* ... */
  });
  test.afterAll(async ({ server }) => {
    /* ... */
  });

  // Tests
  test('test case', async ({ mcp }) => {
    /* ... */
  });
  test.skip('skipped test', async ({ mcp }) => {
    /* ... */
  });
  test.only('focused test', async ({ mcp }) => {
    /* ... */
  });
});
```

### MCP Client Fixture

The `mcp` fixture is your primary interface for testing:

```typescript
interface McpTestClient {
  // ═══════════════════════════════════════════════════════════════════
  // CONNECTION & SESSION
  // ═══════════════════════════════════════════════════════════════════

  isConnected(): boolean;
  sessionId: string;

  disconnect(): Promise<void>;
  reconnect(options?: { sessionId?: string }): Promise<void>;

  session: {
    createdAt: Date;
    lastActivityAt: Date;
    requestCount: number;
    expire(): Promise<void>; // Force session expiration (testing)
  };

  // ═══════════════════════════════════════════════════════════════════
  // SERVER INFO & CAPABILITIES
  // ═══════════════════════════════════════════════════════════════════

  serverInfo: {
    name: string;
    version: string;
    title?: string;
  };

  protocolVersion: string; // e.g., '2024-11-05'
  instructions: string; // Server instructions text

  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: object;
    sampling?: object;
  };

  hasCapability(name: 'tools' | 'resources' | 'prompts' | 'logging' | 'sampling'): boolean;

  // ═══════════════════════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════════════════════

  tools: {
    /** List all available tools */
    list(): Promise<Tool[]>;

    /** Call a tool by name with arguments */
    call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // RESOURCES
  // ═══════════════════════════════════════════════════════════════════

  resources: {
    /** List all static resources */
    list(): Promise<Resource[]>;

    /** List all resource templates */
    listTemplates(): Promise<ResourceTemplate[]>;

    /** Read a resource by URI */
    read(uri: string): Promise<ResourceContent>;

    /** Subscribe to resource changes (if supported) */
    subscribe(uri: string): Promise<void>;
    unsubscribe(uri: string): Promise<void>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // PROMPTS
  // ═══════════════════════════════════════════════════════════════════

  prompts: {
    /** List all available prompts */
    list(): Promise<Prompt[]>;

    /** Get a prompt with arguments */
    get(name: string, args?: Record<string, string>): Promise<PromptResult>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // RAW PROTOCOL ACCESS
  // ═══════════════════════════════════════════════════════════════════

  raw: {
    /** Send any JSON-RPC request */
    request(message: {
      jsonrpc: '2.0';
      id: string | number;
      method: string;
      params?: unknown;
    }): Promise<JSONRPCResponse>;

    /** Send a notification (no response expected) */
    notify(message: { jsonrpc: '2.0'; method: string; params?: unknown }): Promise<void>;

    /** Send raw string data (for error testing) */
    sendRaw(data: string): Promise<JSONRPCResponse>;
  };

  lastRequestId: string | number; // ID of last request sent

  // ═══════════════════════════════════════════════════════════════════
  // TRANSPORT
  // ═══════════════════════════════════════════════════════════════════

  transport: {
    type: 'sse' | 'streamable-http';
    isConnected(): boolean;

    // SSE-specific
    messageEndpoint?: string; // POST endpoint for messages

    // Metrics
    connectionCount: number; // Number of connections made
    reconnectCount: number; // Number of reconnections
    lastRequestHeaders: Record<string, string>;

    // Testing helpers
    simulateDisconnect(): Promise<void>;
    waitForReconnect(timeoutMs: number): Promise<void>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════

  notifications: {
    /** Start collecting server notifications */
    collect(): NotificationCollector;

    /** Collect progress notifications specifically */
    collectProgress(): ProgressCollector;

    /** Send a notification to the server */
    send(method: string, params?: unknown): Promise<void>;
  };

  // ═══════════════════════════════════════════════════════════════════
  // LOGGING & DEBUGGING
  // ═══════════════════════════════════════════════════════════════════

  logs: {
    /** Get all captured log entries */
    all(): LogEntry[];

    /** Filter logs by level */
    filter(level: 'debug' | 'info' | 'warn' | 'error'): LogEntry[];

    /** Search logs by text */
    search(text: string): LogEntry[];

    /** Get the last log entry */
    last(): LogEntry | undefined;

    /** Clear captured logs */
    clear(): void;
  };

  trace: {
    /** Get all request/response traces */
    all(): RequestTrace[];

    /** Get the last trace */
    last(): RequestTrace | undefined;

    /** Clear traces */
    clear(): void;
  };

  // ═══════════════════════════════════════════════════════════════════
  // AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════

  auth: {
    isAnonymous: boolean;
    token?: string;
    scopes: string[];
    user?: { sub: string; email?: string; name?: string };
  };

  /** Authenticate with a token */
  authenticate(token: string): Promise<void>;

  /** Set request timeout */
  setTimeout(ms: number): void;
}
```

### Server Fixture

The `server` fixture provides server control:

```typescript
interface ServerFixture {
  /** Server information */
  info: {
    baseUrl: string;
    port: number;
    pid?: number;
  };

  /** Create additional MCP clients */
  createClient(options?: {
    transport?: 'sse' | 'streamable-http';
    protocolVersion?: string;
    token?: string;
  }): Promise<McpTestClient>;

  /** Register hook listener (for testing) */
  onHook(
    hookPath: string, // e.g., 'tools:call-tool:pre:execute'
    callback: (ctx: HookContext) => void,
  ): void;

  /** Restart the server */
  restart(): Promise<void>;

  /** Get server logs */
  getLogs(): LogEntry[];
}
```

### Auth Fixture

The `auth` fixture helps with authentication testing:

```typescript
interface AuthFixture {
  /** Create a JWT token with claims */
  createToken(options: {
    sub: string;
    scopes?: string[];
    email?: string;
    name?: string;
    claims?: Record<string, unknown>;
    expiresIn?: number; // seconds
  }): Promise<string>;

  /** Create an expired token */
  createExpiredToken(options: { sub: string }): Promise<string>;

  /** Create token with invalid signature */
  createInvalidToken(options: { sub: string }): string;

  /** Pre-built test users */
  users: {
    admin: { sub: string; scopes: string[] };
    user: { sub: string; scopes: string[] };
    readOnly: { sub: string; scopes: string[] };
    anonymous: { sub: string; scopes: string[] };
  };

  /** Get the public JWKS */
  getJwks(): JSONWebKeySet;
}
```

### Custom Matchers

`@frontmcp/testing` extends `expect` with MCP-specific matchers:

```typescript
// ═══════════════════════════════════════════════════════════════════
// TOOL MATCHERS
// ═══════════════════════════════════════════════════════════════════

// Check if tools array contains a tool by name
expect(tools).toContainTool('tool-name');

// Check tool result success
expect(result).toBeSuccessful();
expect(result).toBeError();
expect(result).toBeError(-32602); // Specific error code

// Check tool result content
expect(result).toHaveTextContent();
expect(result).toHaveTextContent('expected text');
expect(result).toHaveImageContent();
expect(result).toHaveResourceContent();

// ═══════════════════════════════════════════════════════════════════
// RESOURCE MATCHERS
// ═══════════════════════════════════════════════════════════════════

// Check if resources array contains a resource
expect(resources).toContainResource('notes://all');
expect(resources).toContainResourceTemplate('notes://note/{id}');

// Check resource content
expect(content).toHaveMimeType('application/json');
expect(content).toHaveTextContent();

// ═══════════════════════════════════════════════════════════════════
// PROMPT MATCHERS
// ═══════════════════════════════════════════════════════════════════

// Check if prompts array contains a prompt
expect(prompts).toContainPrompt('prompt-name');

// Check prompt result
expect(prompt).toHaveMessages(2);
expect(prompt.messages[0]).toHaveRole('user');
expect(prompt.messages[0]).toContainText('expected');

// ═══════════════════════════════════════════════════════════════════
// PROTOCOL MATCHERS
// ═══════════════════════════════════════════════════════════════════

// JSON-RPC response validation
expect(response).toBeValidJsonRpc();
expect(response).toHaveResult();
expect(response).toHaveError();
expect(response).toHaveErrorCode(-32601);
```

---

## Testing Guide

### Testing Tools

```typescript
import { test, expect } from '@frontmcp/testing';
import MyServer from './src/main';

test.use({ server: MyServer });

test.describe('Tools', () => {
  test('list all tools', async ({ mcp }) => {
    const tools = await mcp.tools.list();

    expect(tools).toHaveLength(5);
    expect(tools).toContainTool('create-note');
    expect(tools).toContainTool('list-notes');

    // Check tool schema
    const createNote = tools.find((t) => t.name === 'create-note');
    expect(createNote.inputSchema).toMatchObject({
      type: 'object',
      required: ['title'],
    });
  });

  test('call tool with valid input', async ({ mcp }) => {
    const result = await mcp.tools.call('create-note', {
      title: 'Test Note',
      content: 'Hello world',
    });

    expect(result).toBeSuccessful();
    expect(result).toHaveTextContent();

    // Use generic type parameter for type-safe JSON parsing
    const data = result.json<{ id: string; title: string }>();
    expect(data.id).toBeDefined();
    expect(data.title).toBe('Test Note');
  });

  test('call tool with invalid input', async ({ mcp }) => {
    const result = await mcp.tools.call('create-note', {
      // missing required 'title'
    });

    expect(result).toBeError(-32602); // Invalid params
  });

  test('call non-existent tool', async ({ mcp }) => {
    const result = await mcp.tools.call('unknown-tool', {});

    expect(result).toBeError(-32601); // Method not found
  });
});
```

### Testing Resources

```typescript
test.describe('Resources', () => {
  test('list resources', async ({ mcp }) => {
    const resources = await mcp.resources.list();

    expect(resources).toContainResource('notes://all');
    expect(resources).toContainResource('tasks://all');
  });

  test('list resource templates', async ({ mcp }) => {
    const templates = await mcp.resources.listTemplates();

    expect(templates).toContainResourceTemplate('notes://note/{noteId}');
  });

  test('read static resource', async ({ mcp }) => {
    const content = await mcp.resources.read('notes://all');

    expect(content).toBeSuccessful();
    expect(content).toHaveMimeType('application/json');

    const data = content.json();
    expect(data.notes).toBeInstanceOf(Array);
  });

  test('read templated resource', async ({ mcp }) => {
    const content = await mcp.resources.read('notes://note/123');

    expect(content).toBeSuccessful();
    expect(content.json().id).toBe('123');
  });

  test('read non-existent resource', async ({ mcp }) => {
    const content = await mcp.resources.read('notes://note/nonexistent');

    expect(content).toBeError(-32002); // Resource not found
  });
});
```

### Testing Prompts

```typescript
test.describe('Prompts', () => {
  test('list prompts', async ({ mcp }) => {
    const prompts = await mcp.prompts.list();

    expect(prompts).toContainPrompt('summarize-notes');
    expect(prompts).toContainPrompt('prioritize-tasks');
  });

  test('get prompt', async ({ mcp }) => {
    const result = await mcp.prompts.get('summarize-notes', {
      tag: 'work',
      format: 'detailed',
    });

    expect(result).toBeSuccessful();
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toHaveRole('user');
    expect(result.messages[0]).toContainText('work');
  });
});
```

### Testing Authentication

```typescript
test.describe('Authentication', () => {
  // Public mode - no auth required
  test.describe('Public Mode', () => {
    test.use({ server: MyServer, auth: { mode: 'public' } });

    test('allows anonymous access', async ({ mcp }) => {
      expect(mcp.auth.isAnonymous).toBe(true);

      const tools = await mcp.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  // Orchestrated mode - auth required
  test.describe('Orchestrated Mode', () => {
    test.use({
      server: MyServer,
      auth: { mode: 'orchestrated', type: 'local' },
    });

    test('requires authentication', async ({ mcp }) => {
      // Client without token
      await expect(mcp.tools.list()).rejects.toThrow('Unauthorized');
    });

    test('accepts valid token', async ({ mcp, auth }) => {
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read', 'write'],
      });

      await mcp.authenticate(token);

      const tools = await mcp.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    });

    test('rejects expired token', async ({ mcp, auth }) => {
      const token = await auth.createExpiredToken({ sub: 'user-123' });

      await expect(mcp.authenticate(token)).rejects.toThrow('expired');
    });

    test('enforces scopes', async ({ mcp, auth }) => {
      // Token with only 'read' scope
      const token = await auth.createToken({
        sub: 'user-123',
        scopes: ['read'],
      });

      await mcp.authenticate(token);

      // Read operations work
      const resources = await mcp.resources.list();
      expect(resources.length).toBeGreaterThan(0);

      // Write operations fail (if tool requires 'write' scope)
      const result = await mcp.tools.call('create-note', { title: 'Test' });
      expect(result).toBeError(); // Insufficient scopes
    });
  });
});
```

### Testing Transports

```typescript
test.describe('SSE Transport', () => {
  test.use({ server: MyServer, transport: 'sse' });

  test('connects via SSE', async ({ mcp }) => {
    expect(mcp.transport.type).toBe('sse');
    expect(mcp.transport.isConnected()).toBe(true);
  });

  test('receives endpoint event', async ({ mcp }) => {
    expect(mcp.transport.messageEndpoint).toContain('/message');
  });

  test('maintains persistent connection', async ({ mcp }) => {
    await mcp.tools.list();
    await mcp.resources.list();
    await mcp.prompts.list();

    expect(mcp.transport.connectionCount).toBe(1);
  });

  test('handles reconnection', async ({ mcp }) => {
    await mcp.transport.simulateDisconnect();
    await mcp.transport.waitForReconnect(5000);

    expect(mcp.transport.isConnected()).toBe(true);
    expect(mcp.transport.reconnectCount).toBe(1);
  });
});

test.describe('StreamableHTTP Transport', () => {
  test.use({ server: MyServer, transport: 'streamable-http' });

  test('connects via StreamableHTTP', async ({ mcp }) => {
    expect(mcp.transport.type).toBe('streamable-http');
    expect(mcp.transport.isConnected()).toBe(true);
  });

  test('uses session headers', async ({ mcp }) => {
    await mcp.tools.list();

    expect(mcp.transport.lastRequestHeaders['mcp-session-id']).toBe(mcp.sessionId);
  });
});

test.describe('Transport Comparison', () => {
  test('both transports return same data', async ({ server }) => {
    const sseClient = await server.createClient({ transport: 'sse' });
    const httpClient = await server.createClient({ transport: 'streamable-http' });

    const sseTools = await sseClient.tools.list();
    const httpTools = await httpClient.tools.list();

    expect(sseTools).toEqual(httpTools);

    await sseClient.disconnect();
    await httpClient.disconnect();
  });
});
```

### Testing Notifications

```typescript
test.describe('Notifications', () => {
  test('receives list_changed notification', async ({ mcp }) => {
    const notifications = mcp.notifications.collect();

    // Trigger a change
    await mcp.tools.call('create-note', { title: 'New' });

    await notifications.waitFor('notifications/resources/list_changed', 1000);

    expect(notifications.has('notifications/resources/list_changed')).toBe(true);
  });

  test('receives progress notifications', async ({ mcp }) => {
    const progress = mcp.notifications.collectProgress();

    const resultPromise = mcp.tools.call('long-task', {});
    await progress.waitForComplete(10000);

    expect(progress.updates.length).toBeGreaterThan(0);
    expect(progress.updates[progress.updates.length - 1].progress).toBe(100);

    await resultPromise;
  });

  test('sends client notification', async ({ mcp }) => {
    await mcp.notifications.send('notifications/roots/list_changed');
    // No error = success
  });

  test('cancels request', async ({ mcp }) => {
    const promise = mcp.tools.call('slow-tool', {});
    const requestId = mcp.lastRequestId;

    await mcp.notifications.send('notifications/cancelled', {
      requestId,
      reason: 'User cancelled',
    });

    await expect(promise).rejects.toMatchObject({ code: -32800 });
  });
});
```

### Logging & Debugging

```typescript
test.describe('Logging', () => {
  test.use({ server: MyServer, logLevel: 'debug' });

  test('captures server logs', async ({ mcp }) => {
    await mcp.tools.call('create-note', { title: 'Test' });

    const logs = mcp.logs.all();
    expect(logs.length).toBeGreaterThan(0);
  });

  test('filters logs by level', async ({ mcp }) => {
    await mcp.tools.call('create-note', { title: 'Test' });

    expect(mcp.logs.filter('error')).toHaveLength(0);
    expect(mcp.logs.filter('debug').length).toBeGreaterThan(0);
  });

  test('traces requests', async ({ mcp }) => {
    await mcp.tools.call('create-note', { title: 'Test' });

    const trace = mcp.trace.last();
    expect(trace.request.method).toBe('tools/call');
    expect(trace.response.result).toBeDefined();
    expect(trace.durationMs).toBeLessThan(1000);
  });

  test('dumps full conversation', async ({ mcp }) => {
    await mcp.tools.list();
    await mcp.tools.call('create-note', { title: 'Test' });

    const history = mcp.trace.all();
    expect(history).toHaveLength(3); // init + list + call
  });
});
```

### Testing Plugins

```typescript
test.describe('Plugin Testing', () => {
  test.use({ server: MyServer });

  test('plugin registers tools', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('plugin:my-action');
  });

  test('plugin tool executes', async ({ mcp }) => {
    const result = await mcp.tools.call('plugin:my-action', {
      data: 'test',
    });
    expect(result).toBeSuccessful();
  });

  test('plugin tool returns expected data', async ({ mcp }) => {
    const result = await mcp.tools.call('plugin:my-action', { data: 'test' });
    expect(result).toBeSuccessful();
    expect(result.json()).toMatchObject({ processed: true });
  });
});
```

### Testing Adapters

```typescript
import { httpMock } from '@frontmcp/testing';

test.describe('OpenAPI Adapter', () => {
  test.use({
    server: MyServer,
    env: { OPENAPI_URL: 'https://api.example.com/openapi.json' },
  });

  test('exposes operations as tools', async ({ mcp }) => {
    const tools = await mcp.tools.list();
    expect(tools).toContainTool('openapi:getUsers');
    expect(tools).toContainTool('openapi:createUser');
  });

  test('calls external API', async ({ mcp }) => {
    // Mock external API using httpMock
    const interceptor = httpMock.interceptor();
    // Use { body: ... } format for response data
    interceptor.get('https://api.example.com/users', {
      body: [{ id: 1, name: 'John' }],
    });

    const result = await mcp.tools.call('openapi:getUsers', {});

    expect(result).toBeSuccessful();
    expect(result.json()).toContainEqual({ id: 1, name: 'John' });

    interceptor.restore();
  });
});
```

### HTTP Mocking

Mock external HTTP requests made by your tools for fully offline testing:

```typescript
import { httpMock, httpResponse } from '@frontmcp/testing';

test.describe('HTTP Mocking', () => {
  test('mock external API calls', async ({ mcp }) => {
    // Create an HTTP interceptor
    const interceptor = httpMock.interceptor();

    // Mock GET request - use { body: ... } for response data
    interceptor.get('https://api.weather.com/london', {
      body: { temperature: 72, conditions: 'sunny' },
    });

    // Mock POST request with pattern matching
    interceptor.post(/api\.example\.com\/users/, {
      status: 201,
      body: { id: 2, name: 'Jane' },
    });

    // Call your tool that makes HTTP requests
    const result = await mcp.tools.call('fetch-weather', { city: 'london' });
    expect(result).toBeSuccessful();

    // Verify all mocks were used
    interceptor.assertDone();

    // Clean up
    interceptor.restore();
  });

  test('use response helpers', async ({ mcp }) => {
    const interceptor = httpMock.interceptor();

    // Use helper methods for common responses
    interceptor.get('/api/data', httpResponse.json({ id: 1 }));
    interceptor.get('/api/missing', httpResponse.notFound());
    interceptor.get('/api/slow', httpResponse.delayed({ data: 'result' }, 500));

    // ...test your tools...

    interceptor.restore();
  });

  test('track calls', async ({ mcp }) => {
    const interceptor = httpMock.interceptor();
    const handle = interceptor.get('https://api.example.com/users', { body: [] });

    await mcp.tools.call('list-users', {});

    // Check call count
    expect(handle.callCount()).toBe(1);

    // Get call details
    const calls = handle.calls();
    expect(calls[0].headers['authorization']).toBeDefined();

    interceptor.restore();
  });
});
```

### Raw Protocol Access

```typescript
test.describe('Raw Protocol', () => {
  test('send custom request', async ({ mcp }) => {
    const response = await mcp.raw.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });

    expect(response).toBeValidJsonRpc();
    expect(response.result.tools).toBeDefined();
  });

  test('send notification', async ({ mcp }) => {
    await mcp.raw.notify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
  });

  test('handle parse error', async ({ mcp }) => {
    const response = await mcp.raw.sendRaw('invalid json');
    expect(response).toHaveErrorCode(-32700);
  });

  test('handle method not found', async ({ mcp }) => {
    const response = await mcp.raw.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'unknown/method',
      params: {},
    });
    expect(response).toHaveErrorCode(-32601);
  });
});
```

---

## Configuration

### Jest Configuration

Create `jest.e2e.config.ts`:

```typescript
import type { Config } from 'jest';

const config: Config = {
  displayName: 'e2e',
  preset: '@frontmcp/testing/jest-preset',
  testMatch: ['**/*.e2e.ts'],
  testTimeout: 30000,
  setupFilesAfterEnv: ['@frontmcp/testing/setup'],
};

export default config;
```

### Environment Variables

```bash
# Test configuration
FRONTMCP_TEST_PORT=3003          # Default port for test servers
FRONTMCP_TEST_TIMEOUT=30000      # Default test timeout (ms)
FRONTMCP_TEST_LOG_LEVEL=warn     # Log level during tests

# Debug mode
FRONTMCP_TEST_DEBUG=true         # Enable verbose logging
FRONTMCP_TEST_KEEP_SERVER=true   # Don't stop server after tests
```

---

## Best Practices

### 1. Isolate Tests

Each test should be independent:

```typescript
test.beforeEach(async ({ mcp }) => {
  // Reset state before each test
  await mcp.tools.call('reset-database', {});
});
```

### 2. Use Descriptive Names

```typescript
test.describe('Notes API', () => {
  test.describe('create-note tool', () => {
    test('creates note with valid input', async ({ mcp }) => {});
    test('fails with missing title', async ({ mcp }) => {});
    test('sanitizes HTML in content', async ({ mcp }) => {});
  });
});
```

### 3. Test Error Cases

```typescript
test('handles all error scenarios', async ({ mcp }) => {
  // Invalid params
  expect(await mcp.tools.call('tool', {})).toBeError(-32602);

  // Not found
  expect(await mcp.resources.read('unknown://x')).toBeError(-32002);

  // Unauthorized (if applicable)
  expect(await mcp.tools.call('admin-tool', {})).toBeError(-32001);
});
```

### 4. Use Snapshots for Schemas

```typescript
test('tool schema matches snapshot', async ({ mcp }) => {
  const tools = await mcp.tools.list();
  const schema = tools.find((t) => t.name === 'my-tool')?.inputSchema;

  expect(schema).toMatchSnapshot();
});
```

### 5. Test Both Transports

```typescript
const transports = ['sse', 'streamable-http'] as const;

for (const transport of transports) {
  test.describe(`${transport} transport`, () => {
    test.use({ server: MyServer, transport });

    test('basic operations work', async ({ mcp }) => {
      const tools = await mcp.tools.list();
      expect(tools.length).toBeGreaterThan(0);
    });
  });
}
```

---

## Troubleshooting

### Server won't start

```typescript
// Check if port is available
test.use({ server: MyServer, port: 0 }); // Use random available port

// Enable debug logging
test.use({ server: MyServer, logLevel: 'debug' });
```

### Connection timeout

```typescript
// Increase timeout
test.use({ server: MyServer, startupTimeout: 60000 });

// Or per-test
test.setTimeout(60000);
```

### Tests are flaky

```typescript
// Use explicit waits
await mcp.notifications.waitFor('event', 5000);

// Clear state between tests
test.beforeEach(async ({ mcp }) => {
  mcp.logs.clear();
  mcp.trace.clear();
});
```

### Debug a specific test

```bash
# Run single test with debug output
FRONTMCP_TEST_DEBUG=true npx jest --testNamePattern "my test"
```

---

## Error Codes Reference

| Code   | Name               | Description               |
| ------ | ------------------ | ------------------------- |
| -32700 | Parse error        | Invalid JSON              |
| -32600 | Invalid request    | Invalid JSON-RPC          |
| -32601 | Method not found   | Unknown method            |
| -32602 | Invalid params     | Invalid method parameters |
| -32603 | Internal error     | Server error              |
| -32000 | Server error       | Generic server error      |
| -32001 | Unauthorized       | Authentication required   |
| -32002 | Resource not found | Resource doesn't exist    |
| -32800 | Request cancelled  | Request was cancelled     |

---

## License

Apache-2.0

---

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development setup and guidelines.
