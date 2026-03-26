---
name: setup-testing
description: Configure and run unit and E2E tests for FrontMCP applications. Use when writing tests, setting up Jest, configuring coverage, or testing tools and resources.
tags:
  - testing
  - jest
  - e2e
  - quality
bundle:
  - recommended
  - full
visibility: both
priority: 5
parameters:
  - name: test-type
    description: Type of test to set up (unit, e2e, or both)
    type: string
    required: false
    default: both
  - name: coverage-threshold
    description: Minimum coverage percentage required
    type: number
    required: false
    default: 95
examples:
  - scenario: Set up unit tests for a tool with Jest
    parameters:
      test-type: unit
    expected-outcome: Tool execute method is tested with mocked context, assertions verify output schema
  - scenario: Set up E2E tests against a running MCP server
    parameters:
      test-type: e2e
    expected-outcome: McpTestClient connects to server, calls tools, and verifies responses with MCP matchers
  - scenario: Configure full test suite with 95% coverage enforcement
    parameters:
      test-type: both
      coverage-threshold: 95
    expected-outcome: Jest runs unit and E2E tests with coverage thresholds enforced in CI
license: MIT
compatibility: Requires Node.js 18+, Jest 29+, and @frontmcp/testing for E2E tests
metadata:
  category: testing
  difficulty: beginner
  docs: https://docs.agentfront.dev/frontmcp/testing/overview
---

# Set Up Testing for FrontMCP Applications

This skill covers testing FrontMCP applications at three levels: unit tests for individual tools/resources/prompts, E2E tests exercising the full MCP protocol, and manual testing with `frontmcp dev`.

## Testing Standards

FrontMCP requires:

- **95%+ coverage** across statements, branches, functions, and lines
- **All tests passing** with zero failures
- **File naming**: all test files use `.spec.ts` extension (NOT `.test.ts`)
- **E2E test naming**: use `.e2e.spec.ts` suffix
- **Performance test naming**: use `.perf.spec.ts` suffix
- **Playwright test naming**: use `.pw.spec.ts` suffix

## Unit Testing with Jest

### Test File Structure

Place test files next to the source file or in a `__tests__` directory:

```
src/
  tools/
    my-tool.ts
    __tests__/
      my-tool.spec.ts        # Unit tests
```

### Testing a Tool

Tools extend `ToolContext` and implement `execute()`. Test the execute method by providing mock inputs and verifying outputs match the MCP `CallToolResult` shape.

```typescript
// my-tool.spec.ts
import { MyTool } from '../my-tool';

describe('MyTool', () => {
  let tool: MyTool;

  beforeEach(() => {
    tool = new MyTool();
  });

  it('should return formatted result for valid input', async () => {
    // Create a mock execution context
    const mockContext = {
      scope: {
        get: jest.fn(),
        tryGet: jest.fn(),
      },
      fail: jest.fn(),
      mark: jest.fn(),
      fetch: jest.fn(),
    };

    // Bind mock context
    Object.assign(tool, mockContext);

    const result = await tool.execute({ query: 'test input' });

    expect(result).toEqual({
      content: [{ type: 'text', text: expect.stringContaining('test input') }],
    });
  });

  it('should handle missing optional parameters', async () => {
    const mockContext = {
      scope: { get: jest.fn(), tryGet: jest.fn() },
      fail: jest.fn(),
      mark: jest.fn(),
      fetch: jest.fn(),
    };
    Object.assign(tool, mockContext);

    const result = await tool.execute({ query: 'test' });

    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('should throw for invalid input', async () => {
    const mockContext = {
      scope: { get: jest.fn(), tryGet: jest.fn() },
      fail: jest.fn(),
    };
    Object.assign(tool, mockContext);

    await expect(tool.execute({ query: '' })).rejects.toThrow();
  });
});
```

### Testing a Resource

Resources extend `ResourceContext` and implement `read()`. Verify the output matches the MCP `ReadResourceResult` shape.

```typescript
// my-resource.spec.ts
import { MyResource } from '../my-resource';

describe('MyResource', () => {
  it('should return resource contents', async () => {
    const resource = new MyResource();
    const result = await resource.read({ id: '123' });

    expect(result).toEqual({
      contents: [
        {
          uri: expect.stringMatching(/^resource:\/\//),
          mimeType: 'application/json',
          text: expect.any(String),
        },
      ],
    });
  });
});
```

### Testing a Prompt

Prompts extend `PromptContext` and implement `execute()`. Verify the output matches the MCP `GetPromptResult` shape.

```typescript
// my-prompt.spec.ts
import { MyPrompt } from '../my-prompt';

describe('MyPrompt', () => {
  it('should return a valid GetPromptResult', async () => {
    const prompt = new MyPrompt();
    const result = await prompt.execute({ topic: 'testing' });

    expect(result).toEqual({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.objectContaining({ type: 'text' }),
        }),
      ]),
    });
  });
});
```

### Testing Error Classes

Always verify error classes with `instanceof` checks and error codes:

```typescript
import { ResourceNotFoundError, MCP_ERROR_CODES } from '@frontmcp/sdk';

describe('ResourceNotFoundError', () => {
  it('should be instanceof ResourceNotFoundError', () => {
    const error = new ResourceNotFoundError('test://resource');
    expect(error).toBeInstanceOf(ResourceNotFoundError);
    expect(error.mcpErrorCode).toBe(MCP_ERROR_CODES.RESOURCE_NOT_FOUND);
  });

  it('should produce correct JSON-RPC error', () => {
    const error = new ResourceNotFoundError('test://resource');
    const rpc = error.toJsonRpcError();
    expect(rpc.code).toBe(-32002);
    expect(rpc.data).toEqual({ uri: 'test://resource' });
  });
});
```

### Testing Constructor Validation

Always test that constructors throw on invalid input:

```typescript
describe('MyService constructor', () => {
  it('should throw when required config is missing', () => {
    expect(() => new MyService({})).toThrow();
  });

  it('should accept valid config', () => {
    const service = new MyService({ endpoint: 'https://example.com' });
    expect(service).toBeDefined();
  });
});
```

## E2E Testing with @frontmcp/testing

The `@frontmcp/testing` library provides a full E2E testing framework with a test client, server lifecycle management, custom matchers, and fixture utilities.

### Key Exports from @frontmcp/testing

```typescript
import {
  // Primary API (fixture-based)
  test,
  expect,

  // Manual client API
  McpTestClient,
  McpTestClientBuilder,

  // Server management
  TestServer,

  // Auth testing
  TestTokenFactory,
  AuthHeaders,
  TestUsers,
  MockOAuthServer,
  MockAPIServer,
  MockCimdServer,

  // Assertions & matchers
  McpAssertions,
  mcpMatchers,

  // Interceptors & mocking
  DefaultMockRegistry,
  DefaultInterceptorChain,
  mockResponse,
  interceptors,
  httpMock,
  httpResponse,

  // Performance testing
  perfTest,
  MetricsCollector,
  LeakDetector,
  BaselineStore,
  RegressionDetector,
  ReportGenerator,

  // Low-level client
  McpClient,
  McpStdioClientTransport,
} from '@frontmcp/testing';
```

### Install the Testing Package

```bash
yarn add -D @frontmcp/testing
```

### Fixture-Based E2E Tests (Recommended)

The fixture API manages server lifecycle automatically:

```typescript
// my-server.e2e.spec.ts
import { test, expect } from '@frontmcp/testing';

test.use({
  server: './src/main.ts',
  port: 3003,
});

test('server exposes expected tools', async ({ mcp }) => {
  const tools = await mcp.tools.list();
  expect(tools).toContainTool('create_record');
  expect(tools).toContainTool('delete_record');
});

test('create_record tool returns success', async ({ mcp }) => {
  const result = await mcp.tools.call('create_record', {
    name: 'Test Record',
    type: 'example',
  });

  expect(result).toBeSuccessful();
  expect(result).toHaveTextContent('created');
});

test('reading a resource returns valid content', async ({ mcp }) => {
  const result = await mcp.resources.read('config://server-info');

  expect(result.contents).toHaveLength(1);
  expect(result.contents[0]).toHaveProperty('mimeType', 'application/json');
});

test('prompts return well-formed messages', async ({ mcp }) => {
  const result = await mcp.prompts.get('summarize', { topic: 'testing' });

  expect(result.messages).toBeDefined();
  expect(result.messages.length).toBeGreaterThan(0);
});
```

### Manual Client E2E Tests

For more control, use `McpTestClient` and `TestServer` directly:

```typescript
// advanced.e2e.spec.ts
import { McpTestClient, TestServer } from '@frontmcp/testing';

describe('Advanced E2E', () => {
  let server: TestServer;
  let client: McpTestClient;

  beforeAll(async () => {
    server = await TestServer.start({
      command: 'npx tsx src/main.ts',
      port: 3004,
    });

    client = await McpTestClient.create({ baseUrl: server.info.baseUrl })
      .withTransport('streamable-http')
      .buildAndConnect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.stop();
  });

  it('should list tools after initialization', async () => {
    const tools = await client.tools.list();
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should handle tool errors gracefully', async () => {
    const result = await client.tools.call('nonexistent_tool', {});
    expect(result).toBeError();
  });
});
```

### Testing with Authentication

```typescript
import { test, expect, TestTokenFactory } from '@frontmcp/testing';

test.use({
  server: './src/main.ts',
  port: 3005,
  auth: {
    issuer: 'https://auth.example.com/',
    audience: 'https://api.example.com',
  },
});

test('authenticated tool call succeeds', async ({ mcp, auth }) => {
  const token = await auth.createToken({ sub: 'user-123', scopes: ['tools:read'] });
  mcp.setAuthToken(token);

  const result = await mcp.tools.call('get_user_profile', {});
  expect(result).toBeSuccessful();
});

test('unauthenticated call is rejected', async ({ mcp }) => {
  mcp.clearAuthToken();

  const result = await mcp.tools.call('get_user_profile', {});
  expect(result).toBeError();
});
```

## Custom MCP Matchers

`@frontmcp/testing` provides Jest matchers tailored for MCP responses. Import `expect` from `@frontmcp/testing` instead of from Jest:

```typescript
import { expect } from '@frontmcp/testing';
```

| Matcher                   | Asserts                                               |
| ------------------------- | ----------------------------------------------------- |
| `toContainTool(name)`     | Tools list includes a tool with the given name        |
| `toContainResource(uri)`  | Resources list includes a resource with the given URI |
| `toContainPrompt(name)`   | Prompts list includes a prompt with the given name    |
| `toBeSuccessful()`        | Tool call result is not an error                      |
| `toBeError()`             | Tool call result is an MCP error                      |
| `toHaveTextContent(text)` | Result contains text content matching the string      |
| `toHaveMimeType(mime)`    | Resource content has the expected MIME type           |

## Running Tests with Nx

FrontMCP uses Nx as its build system. Run tests with these commands:

```bash
# Run all tests for a specific library
nx test sdk

# Run tests for a specific file
nx test my-app --testFile=src/tools/__tests__/my-tool.spec.ts

# Run all tests across the monorepo
nx run-many -t test

# Run with coverage
nx test sdk --coverage

# Run only E2E tests (by pattern)
nx test sdk --testPathPattern='\.e2e\.spec\.ts$'

# Run a single test by name
nx test sdk --testNamePattern='should return formatted output'
```

## Jest Configuration

Each library has its own `jest.config.ts`. Coverage thresholds are enforced per library:

```typescript
// jest.config.ts
export default {
  displayName: 'my-lib',
  preset: '../../jest.preset.js',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  coverageThreshold: {
    global: {
      statements: 95,
      branches: 95,
      functions: 95,
      lines: 95,
    },
  },
};
```

## Manual Testing with frontmcp dev

For interactive development and manual testing, use the CLI:

```bash
# Start the dev server with hot reload
frontmcp dev

# Start on a specific port
frontmcp dev --port 4000

# The dev server exposes your MCP server over Streamable HTTP
# Connect any MCP client (Claude Desktop, cursor, etc.) to test interactively
```

This is useful for:

- Verifying tool behavior with a real AI client
- Testing the full request/response cycle
- Debugging issues that are hard to reproduce in automated tests
- Validating authentication flows end-to-end

## Cleanup Before Committing

Always run the unused import cleanup script on changed files:

```bash
# Remove unused imports from files changed vs main
node scripts/fix-unused-imports.mjs

# Custom base branch
node scripts/fix-unused-imports.mjs feature/my-branch
```

## Testing Patterns Summary

| What to Test             | How                                               | File Suffix     |
| ------------------------ | ------------------------------------------------- | --------------- |
| Tool execute logic       | Unit test with mock context                       | `.spec.ts`      |
| Resource read logic      | Unit test with mock params                        | `.spec.ts`      |
| Prompt output shape      | Unit test verifying GetPromptResult               | `.spec.ts`      |
| Full MCP protocol flow   | E2E with McpTestClient                            | `.e2e.spec.ts`  |
| Error handling           | Unit test verifying specific error classes/codes  | `.spec.ts`      |
| Plugin behavior          | Unit test providers + integration via test server | `.spec.ts`      |
| Performance regression   | Perf tests with MetricsCollector                  | `.perf.spec.ts` |
| Playwright browser tests | UI tests with Playwright                          | `.pw.spec.ts`   |
| Constructor validation   | Unit test verifying throws on invalid input       | `.spec.ts`      |

## Common Mistakes

- **Using `.test.ts` file extension** -- all test files must use `.spec.ts`. The Nx and Jest configurations expect this convention.
- **Testing implementation details** -- test inputs and outputs, not internal method calls. Tools should be tested through their `execute` interface.
- **Skipping constructor validation tests** -- always test that constructors throw on invalid input.
- **Skipping error `instanceof` checks** -- verify that thrown errors are instances of the correct error class, not just that an error was thrown.
- **Using test ID prefixes** -- do not use prefixes like "PT-001" in test names. Use descriptive names like "should return formatted output for valid input".
- **Falling below 95% coverage** -- the CI pipeline enforces coverage thresholds. Run `nx test <lib> --coverage` locally before pushing.
- **Using `any` in test mocks** -- use `unknown` or properly typed mocks. Follow the strict TypeScript guidelines.

## Reference

- Testing package: [`@frontmcp/testing`](https://docs.agentfront.dev/frontmcp/testing/overview)
- Test client: `McpTestClient` — import from `@frontmcp/testing`
- Test client builder: `McpTestClient.builder()` — fluent API for test setup
- MCP matchers: `toContainTool()`, `toBeSuccessful()` — import from `@frontmcp/testing`
- Test fixtures: `createTestFixture()` — import from `@frontmcp/testing`
- Test server: `TestServer` — import from `@frontmcp/testing`
- Performance testing: `perfTest()`, `MetricsCollector` — import from `@frontmcp/testing`
- Auth testing: `TestTokenFactory`, `MockOAuthServer` — import from `@frontmcp/testing`
- Interceptors: `TestInterceptor` — import from `@frontmcp/testing`
- HTTP mocking: `HttpMock` — import from `@frontmcp/testing`
- [Source code on GitHub](https://github.com/agentfront/frontmcp/tree/main/libs/testing)
