---
name: setup-testing
description: Configure Jest, write unit and E2E tests, and enforce 95%+ coverage for FrontMCP applications
---

# Set Up Testing for FrontMCP Applications

This skill covers testing FrontMCP applications at three levels: unit tests for individual tools/resources/prompts, E2E tests exercising the full MCP protocol, and manual testing with `frontmcp dev`.

## When to Use This Skill

### Must Use

- Writing the first unit test for a new tool, resource, or prompt class
- Setting up Jest configuration and coverage thresholds for a FrontMCP library
- Creating E2E tests that exercise the full MCP protocol via `McpTestClient`

### Recommended

- Adding coverage enforcement to CI for an existing library that lacks thresholds
- Writing authenticated E2E tests with `TestTokenFactory` and `MockOAuthServer`
- Migrating existing `.test.ts` files to the required `.spec.ts` naming convention

### Skip When

- Building a new tool class from scratch (see `create-tool`)
- Creating resources or prompts before you have anything to test (see `create-resource`, `create-prompt`)
- Debugging deployment issues unrelated to test configuration (see `deploy-to-node`, `deploy-to-vercel`)

> **Decision:** Use this skill when you need to configure, write, or run Jest tests for FrontMCP tools, resources, or prompts.

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

```text
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

> **Note:** `npx tsx src/main.ts` is correct **only inside E2E tests** (the test framework uses it internally via `resolveServerCommand`). For development and running the server outside of tests, always use `frontmcp dev` (or your package.json `dev` script). Never run `npx tsx src/main.ts` directly for development.

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
      .withTransport('modern') // 'modern' preset enables streamable HTTP + strict sessions
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

## Common Patterns

| Pattern          | Correct                                                  | Incorrect                                        | Why                                                                            |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Test file naming | `my-tool.spec.ts`, `my-tool.e2e.spec.ts`                 | `my-tool.test.ts`, `my-tool.test.tsx`            | Nx and Jest configs only recognize `.spec.ts` convention                       |
| Test description | `'should return formatted output for valid input'`       | `'PT-001: test formatted output'`                | Descriptive names; no ID prefixes                                              |
| Mock types       | `const ctx = { scope: { get: jest.fn() } } as unknown`   | `const ctx: any = { scope: { get: jest.fn() } }` | Strict TypeScript; avoid `any` in mocks                                        |
| Error assertion  | `expect(err).toBeInstanceOf(ResourceNotFoundError)`      | `expect(() => ...).toThrow()`                    | Verify the exact error class and MCP error code, not just that something threw |
| Constructor test | Always test `new MyService({})` throws on invalid config | Skip constructor validation                      | Catches misconfiguration early; required for 95% branch coverage               |
| E2E test imports | `import { test, expect } from '@frontmcp/testing'`       | `import { expect } from '@jest/globals'`         | `@frontmcp/testing` provides MCP-specific matchers like `toContainTool()`      |
| Coverage check   | `nx test my-lib --coverage` before push                  | Push without coverage check                      | CI enforces 95% thresholds; catch failures locally first                       |

## Verification Checklist

### Configuration

- [ ] Jest config exists with `coverageThreshold` set to 95% for all metrics
- [ ] `tsconfig.spec.json` exists and extends the base tsconfig
- [ ] `@frontmcp/testing` is installed as a dev dependency for E2E tests
- [ ] Test files use `.spec.ts` (unit), `.e2e.spec.ts` (E2E), or `.perf.spec.ts` (perf) extension

### Unit Tests

- [ ] Each tool's `execute()` method is tested with valid and invalid inputs
- [ ] Each resource's `read()` method is tested and output matches `ReadResourceResult` shape
- [ ] Each prompt's `execute()` method is tested and output matches `GetPromptResult` shape
- [ ] Constructor validation tests verify throws on invalid config
- [ ] Error classes are verified with `instanceof` checks and `mcpErrorCode` assertions

### E2E Tests

- [ ] Fixture-based tests use `test.use({ server, port })` for server lifecycle
- [ ] Tools appear in `tools/list` response via `toContainTool()` matcher
- [ ] Tool calls return expected results via `toBeSuccessful()` matcher
- [ ] Authenticated tests use `TestTokenFactory` and verify rejection without token

### CI Integration

- [ ] `nx test <lib> --coverage` passes locally with 95%+ on all metrics
- [ ] Unused imports are cleaned via `node scripts/fix-unused-imports.mjs`
- [ ] No TypeScript warnings in test files

## Troubleshooting

| Problem                                      | Cause                                                   | Solution                                                                                              |
| -------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Jest cannot find test files                  | Files use `.test.ts` instead of `.spec.ts`              | Rename to `.spec.ts`; Nx test runner only picks up `.spec.ts` by default                              |
| Coverage below 95% threshold                 | Untested branches or constructor paths                  | Run `nx test <lib> --coverage` and check the HTML report for uncovered lines                          |
| E2E test times out on `TestServer.start()`   | Server entrypoint fails to start or wrong port          | Verify `server` path and `port` in `test.use()`; check server logs for startup errors                 |
| `toContainTool` matcher not found            | Using `expect` from Jest instead of `@frontmcp/testing` | Import `expect` from `@frontmcp/testing` to get MCP-specific matchers                                 |
| `McpTestClient.create()` connection refused  | Test server not running or wrong `baseUrl`              | Ensure `TestServer.start()` completes before creating client; verify port matches                     |
| Istanbul shows 0% coverage for async methods | TypeScript compilation source-map mismatch              | Known issue with `ts-jest` and certain async patterns; check `tsconfig.spec.json` source-map settings |
| Auth E2E test returns 401 unexpectedly       | Token not set or expired                                | Call `mcp.setAuthToken(token)` before the tool call; use `auth.createToken()` with valid claims       |

## Reference

- [Testing Documentation](https://docs.agentfront.dev/frontmcp/testing/overview)
- Related skills: `create-tool`, `create-resource`, `create-prompt`, `setup-project`, `nx-workflow`
