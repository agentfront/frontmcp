# Testing Guide

Testing strategies and utilities for FrontMCP Browser applications.

## Table of Contents

- [Test Environment Setup](#test-environment-setup)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [React Hook Testing](#react-hook-testing)
- [Transport Mocking](#transport-mocking)
- [Store Testing](#store-testing)
- [E2E Testing](#e2e-testing)

---

## Test Environment Setup

### Jest Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@frontmcp/browser$': '<rootDir>/node_modules/@frontmcp/browser/dist/index.js',
    '^@frontmcp/browser/react$': '<rootDir>/node_modules/@frontmcp/browser/dist/react/index.js',
  },
  transformIgnorePatterns: ['/node_modules/(?!(@frontmcp|valtio)/)'],
};
```

### Jest Setup

```javascript
// jest.setup.js
import '@testing-library/jest-dom';

// Mock Web Crypto API
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
    subtle: {
      sign: jest.fn(),
      verify: jest.fn(),
    },
  },
});

// Mock IndexedDB
import 'fake-indexeddb/auto';

// Mock postMessage
const originalPostMessage = window.postMessage;
window.postMessage = jest.fn((message, origin) => {
  // Simulate message event
  setTimeout(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: message,
        origin: origin === '*' ? window.location.origin : origin,
      }),
    );
  }, 0);
});
```

### Vitest Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
```

---

## Unit Testing

### Testing Store Operations

```typescript
import { createMcpStore } from '@frontmcp/browser';

describe('McpStore', () => {
  it('should create store with initial state', () => {
    const store = createMcpStore({ count: 0, user: null });

    expect(store.state.count).toBe(0);
    expect(store.state.user).toBeNull();
  });

  it('should allow mutations', () => {
    const store = createMcpStore({ count: 0 });

    store.state.count++;

    expect(store.state.count).toBe(1);
  });

  it('should notify subscribers on mutation', () => {
    const store = createMcpStore({ count: 0 });
    const callback = jest.fn();

    store.subscribe(callback);
    store.state.count++;

    // Valtio batches updates
    expect(callback).toHaveBeenCalled();
  });

  it('should track mutation paths', () => {
    const store = createMcpStore({ user: { name: '' } });
    const mutations: unknown[] = [];

    store.onMutation((ops) => mutations.push(...ops));
    store.state.user.name = 'Test';

    expect(mutations).toContainEqual(
      expect.objectContaining({
        path: ['user', 'name'],
      }),
    );
  });
});
```

### Testing Component Registry

```typescript
import { createComponentRegistry } from '@frontmcp/browser';
import { z } from 'zod';

describe('ComponentRegistry', () => {
  let registry: ReturnType<typeof createComponentRegistry>;

  beforeEach(() => {
    registry = createComponentRegistry();
  });

  it('should register components', () => {
    registry.register({
      name: 'Button',
      description: 'A button component',
      inputSchema: z.object({
        label: z.string(),
        onClick: z.function().optional(),
      }),
      category: 'ui',
    });

    expect(registry.has('Button')).toBe(true);
  });

  it('should list components by category', () => {
    registry.register({ name: 'Button', category: 'ui', inputSchema: z.object({}) });
    registry.register({ name: 'Input', category: 'ui', inputSchema: z.object({}) });
    registry.register({ name: 'Chart', category: 'data', inputSchema: z.object({}) });

    const uiComponents = registry.search({ category: 'ui' });

    expect(uiComponents).toHaveLength(2);
    expect(uiComponents.map((c) => c.name)).toContain('Button');
  });

  it('should validate props against schema', () => {
    registry.register({
      name: 'Button',
      inputSchema: z.object({
        label: z.string().min(1),
      }),
    });

    const meta = registry.get('Button');
    const result = meta?.inputSchema.safeParse({ label: '' });

    expect(result?.success).toBe(false);
  });
});
```

---

## Integration Testing

### Testing Server Creation

```typescript
import { createBrowserMcpServer } from '@frontmcp/browser';
import { createMockTransport } from './test-utils';

describe('BrowserMcpServer', () => {
  it('should create server with tools', async () => {
    const transport = createMockTransport();

    const server = await createBrowserMcpServer({
      info: { name: 'TestApp', version: '1.0.0' },
      transport,
      store: { count: 0 },
    });

    expect(server.getTransport()).toBe(transport);
  });

  it('should handle tool registration', async () => {
    const server = await createBrowserMcpServer({
      info: { name: 'TestApp', version: '1.0.0' },
    });

    server.registerTool('increment', {
      description: 'Increment counter',
      inputSchema: z.object({}),
      execute: async () => {
        const store = server.getStore();
        store.state.count++;
        return { count: store.state.count };
      },
    });

    // List tools via MCP
    const tools = await server.listTools();
    expect(tools).toContainEqual(expect.objectContaining({ name: 'increment' }));
  });
});
```

### Testing Tool Execution

```typescript
describe('Tool Execution', () => {
  let server: BrowserMcpServer;

  beforeEach(async () => {
    server = await createBrowserMcpServer({
      info: { name: 'TestApp', version: '1.0.0' },
      store: { items: [] },
    });

    server.registerTool('add-item', {
      description: 'Add item to list',
      inputSchema: z.object({
        name: z.string(),
        quantity: z.number().positive(),
      }),
      execute: async (args) => {
        const store = server.getStore();
        const item = { id: crypto.randomUUID(), ...args };
        store.state.items.push(item);
        return item;
      },
    });
  });

  it('should execute tool with valid input', async () => {
    const result = await server.callTool('add-item', {
      name: 'Widget',
      quantity: 5,
    });

    expect(result).toHaveProperty('id');
    expect(result.name).toBe('Widget');
  });

  it('should reject tool with invalid input', async () => {
    await expect(server.callTool('add-item', { name: '', quantity: -1 })).rejects.toThrow();
  });

  it('should update store after tool execution', async () => {
    await server.callTool('add-item', { name: 'Widget', quantity: 5 });

    const store = server.getStore();
    expect(store.state.items).toHaveLength(1);
  });
});
```

---

## React Hook Testing

### Testing useStore

```typescript
import { renderHook, act } from '@testing-library/react';
import { FrontMcpBrowserProvider, useStore } from '@frontmcp/browser/react';
import { createBrowserMcpServer } from '@frontmcp/browser';

function createWrapper(server: BrowserMcpServer) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <FrontMcpBrowserProvider server={server}>{children}</FrontMcpBrowserProvider>;
  };
}

describe('useStore', () => {
  it('should return store state', async () => {
    const server = await createBrowserMcpServer({
      info: { name: 'Test', version: '1.0.0' },
      store: { count: 42 },
    });

    const { result } = renderHook(() => useStore(), {
      wrapper: createWrapper(server),
    });

    expect(result.current.state.count).toBe(42);
  });

  it('should re-render on state change', async () => {
    const server = await createBrowserMcpServer({
      info: { name: 'Test', version: '1.0.0' },
      store: { count: 0 },
    });

    const { result } = renderHook(() => useStore(), {
      wrapper: createWrapper(server),
    });

    act(() => {
      result.current.store.count++;
    });

    expect(result.current.state.count).toBe(1);
  });
});
```

### Testing useTool

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTool } from '@frontmcp/browser/react';

describe('useTool', () => {
  let server: BrowserMcpServer;

  beforeEach(async () => {
    server = await createBrowserMcpServer({
      info: { name: 'Test', version: '1.0.0' },
    });

    server.registerTool('greet', {
      description: 'Greet user',
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => ({ message: `Hello, ${name}!` }),
    });
  });

  it('should execute tool and return result', async () => {
    const { result } = renderHook(() => useTool<{ name: string }, { message: string }>('greet'), {
      wrapper: createWrapper(server),
    });

    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.execute({ name: 'World' });
    });

    await waitFor(() => {
      expect(result.current.result?.message).toBe('Hello, World!');
    });
  });

  it('should handle errors', async () => {
    server.registerTool('fail', {
      description: 'Always fails',
      inputSchema: z.object({}),
      execute: async () => {
        throw new Error('Intentional failure');
      },
    });

    const { result } = renderHook(() => useTool('fail'), {
      wrapper: createWrapper(server),
    });

    await act(async () => {
      try {
        await result.current.execute({});
      } catch {
        // Expected
      }
    });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it('should track loading state', async () => {
    const { result } = renderHook(() => useTool('greet'), {
      wrapper: createWrapper(server),
    });

    let loadingDuringExecution = false;

    await act(async () => {
      const promise = result.current.execute({ name: 'Test' });
      loadingDuringExecution = result.current.isLoading;
      await promise;
    });

    expect(loadingDuringExecution).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });
});
```

### Testing useResource

```typescript
describe('useResource', () => {
  let server: BrowserMcpServer;

  beforeEach(async () => {
    server = await createBrowserMcpServer({
      info: { name: 'Test', version: '1.0.0' },
    });

    server.registerResource('config://settings', {
      name: 'Settings',
      mimeType: 'application/json',
      read: async () => ({
        contents: [
          {
            uri: 'config://settings',
            mimeType: 'application/json',
            text: JSON.stringify({ theme: 'dark', language: 'en' }),
          },
        ],
      }),
    });
  });

  it('should fetch resource', async () => {
    const { result } = renderHook(() => useResource<{ theme: string }>('config://settings'), {
      wrapper: createWrapper(server),
    });

    await waitFor(() => {
      expect(result.current.data).toBeTruthy();
    });

    expect(result.current.data?.theme).toBe('dark');
  });

  it('should handle resource errors', async () => {
    const { result } = renderHook(() => useResource('nonexistent://resource'), { wrapper: createWrapper(server) });

    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });
});
```

---

## Transport Mocking

### Mock Transport Implementation

```typescript
// test-utils/mock-transport.ts
import { BrowserTransport, JSONRPCMessage } from '@frontmcp/browser';

export function createMockTransport(): BrowserTransport & {
  simulateMessage: (msg: JSONRPCMessage) => void;
  getSentMessages: () => JSONRPCMessage[];
} {
  const handlers = new Set<(msg: JSONRPCMessage) => void>();
  const sentMessages: JSONRPCMessage[] = [];

  return {
    isConnected: true,

    send(message: JSONRPCMessage): void {
      sentMessages.push(message);
    },

    onMessage(handler: (msg: JSONRPCMessage) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },

    close(): void {
      handlers.clear();
    },

    // Test utilities
    simulateMessage(msg: JSONRPCMessage): void {
      handlers.forEach((h) => h(msg));
    },

    getSentMessages(): JSONRPCMessage[] {
      return [...sentMessages];
    },
  };
}
```

### Using Mock Transport

```typescript
describe('Transport Communication', () => {
  it('should send messages through transport', async () => {
    const transport = createMockTransport();
    const server = await createBrowserMcpServer({
      info: { name: 'Test', version: '1.0.0' },
      transport,
    });

    // Simulate client request
    transport.simulateMessage({
      jsonrpc: '2.0',
      id: '1',
      method: 'tools/list',
      params: {},
    });

    // Check response was sent
    const messages = transport.getSentMessages();
    expect(messages).toContainEqual(
      expect.objectContaining({
        jsonrpc: '2.0',
        id: '1',
        result: expect.any(Object),
      }),
    );
  });
});
```

### Mock PostMessageTransport

```typescript
// For testing iframe/worker communication
export function createMockPostMessageTransport() {
  const mockWindow = {
    postMessage: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };

  return {
    mockWindow,
    simulateIncomingMessage: (data: unknown, origin: string) => {
      const listener = mockWindow.addEventListener.mock.calls.find(([event]) => event === 'message')?.[1];

      listener?.({ data, origin, source: mockWindow });
    },
  };
}
```

---

## Store Testing

### Testing Persistence

```typescript
import { createMcpStore, createIndexedDBAdapter } from '@frontmcp/browser';
import 'fake-indexeddb/auto';

describe('Store Persistence', () => {
  it('should persist and restore state', async () => {
    // Create store with persistence
    const store1 = createMcpStore({ count: 0 }, { persistence: { name: 'test-db' } });

    // Mutate and save
    store1.state.count = 42;
    await store1.flush();

    // Create new store with same DB name
    const store2 = createMcpStore({ count: 0 }, { persistence: { name: 'test-db' } });

    await store2.load();

    expect(store2.state.count).toBe(42);
  });

  it('should handle persistence errors gracefully', async () => {
    // Mock IndexedDB error
    const adapter = createIndexedDBAdapter('test-db');
    jest.spyOn(adapter, 'save').mockRejectedValue(new Error('DB Error'));

    const store = createMcpStore({ data: 'test' });

    // Should not throw
    await expect(store.save()).resolves.not.toThrow();
  });
});
```

### Testing Mutation Guards

```typescript
describe('Mutation Guards', () => {
  it('should block unauthorized mutations', async () => {
    const store = createSecureStore({
      initial: { protected: 'value' },
      readOnlyPaths: [['protected']],
    });

    expect(() => {
      store.state.protected = 'hacked';
    }).toThrow(/read-only/);
  });

  it('should allow authorized mutations', async () => {
    const authGuard = jest.fn().mockReturnValue(true);
    const store = createSecureStore({
      initial: { data: 'value' },
      guards: [authGuard],
    });

    store.set(['data'], 'new value', { userId: 'user-1' });

    expect(authGuard).toHaveBeenCalledWith(['data'], 'new value', expect.objectContaining({ userId: 'user-1' }));
  });
});
```

---

## E2E Testing

### Playwright Setup

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    port: 3000,
  },
});
```

### E2E Test Example

```typescript
// e2e/mcp-integration.spec.ts
import { test, expect } from '@playwright/test';

test.describe('FrontMCP Integration', () => {
  test('should execute tool via UI', async ({ page }) => {
    await page.goto('/');

    // Wait for MCP to initialize
    await page.waitForFunction(() => {
      return (window as any).__FRONTMCP__?.server !== undefined;
    });

    // Trigger tool via button click
    await page.click('button[data-tool="increment"]');

    // Verify result
    await expect(page.locator('[data-testid="count"]')).toHaveText('1');
  });

  test('should persist state across reload', async ({ page }) => {
    await page.goto('/');

    // Make changes
    await page.click('button[data-tool="increment"]');
    await page.click('button[data-tool="increment"]');

    // Wait for persistence
    await page.waitForTimeout(500);

    // Reload
    await page.reload();

    // Verify persistence
    await expect(page.locator('[data-testid="count"]')).toHaveText('2');
  });

  test('should render UI resource', async ({ page }) => {
    await page.goto('/');

    // Trigger tool that creates UI resource
    await page.click('button[data-tool="create-chart"]');

    // Wait for iframe to appear
    const iframe = page.frameLocator('[data-testid="ui-resource-frame"]');
    await expect(iframe.locator('canvas')).toBeVisible();
  });
});
```

---

## Test Coverage

### Coverage Configuration

```javascript
// jest.config.js
module.exports = {
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
```

### Running Tests

```bash
# Unit tests
npm test

# With coverage
npm test -- --coverage

# Watch mode
npm test -- --watch

# E2E tests
npx playwright test

# Specific test file
npm test -- src/store/__tests__/store.test.ts
```

---

## See Also

- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Common issues
- [API.md](./API.md) - API reference
- [REACT.md](./REACT.md) - React integration
