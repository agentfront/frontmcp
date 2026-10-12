# @frontmcp/testing

End-to-end tests for FrontMCP servers. It starts your server, gives each test `mcp`, an MCP client connected to it, and adds matchers like `toBeSuccessful()` and `toContainTool()` to `expect`. Tests run under Jest, with `frontmcp test` or your own Jest configuration. It also has the pieces to build tests of your own: a JSON Web Token (JWT) factory, mock OAuth and API servers, HTTP mocking and request interceptors.

[![npm](https://img.shields.io/npm/v/@frontmcp/testing.svg)](https://www.npmjs.com/package/@frontmcp/testing) [![License](https://img.shields.io/npm/l/@frontmcp/testing.svg)](https://github.com/agentfront/frontmcp/blob/main/LICENSE)

## Install

```bash
npm install -D @frontmcp/testing jest tsx
```

Requires Node.js 24 or later, and `@frontmcp/sdk` in the project (a peer dependency, as is `@frontmcp/lazy-zod`, which comes with the SDK). `jest` (29 or 30) runs the tests, and `@jest/globals`, which comes with it, provides `expect`; both are optional peers so that the token factory and mock servers work outside Jest. The library starts your server with `tsx`. `@swc/jest`, which compiles the tests, is installed with the package.

## Usage

```ts
// e2e/tickets.e2e.spec.ts
import { expect, test } from '@frontmcp/testing';

test.use({ server: './src/main.ts' });

test('server exposes tools', async ({ mcp }) => {
  const tools = await mcp.tools.list();
  expect(tools).toContainTool('search_tickets');
});

test('tool execution works', async ({ mcp }) => {
  const result = await mcp.tools.call('search_tickets', { query: 'log' });
  expect(result).toBeSuccessful();
  expect(result.json()).toEqual({ tickets: [{ id: 'T-1', title: 'Cannot log in' }] });
});
```

```bash
npx frontmcp test
```

`frontmcp test` (from the [`frontmcp`](https://www.npmjs.com/package/frontmcp) CLI) runs `src/**/*.spec.ts`, `__tests__/**/*.spec.ts` and `e2e/**/*.e2e.spec.ts` with a Jest configuration it generates. With a `jest.config.*` of your own, use `preset: '@frontmcp/testing'` for the same settings. The server starts when the first test that needs it runs, and tests with the same `test.use()` options share it.

## Fixtures

| Fixture  | Description                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp`    | A client connected to the server, new for each test: `tools`, `resources`, `prompts`, raw requests, notifications and logs                                      |
| `server` | The running server: `info` (`baseUrl`, `port`, `pid`), `createClient()`, `createClientBuilder()`, `restart()`, `getLogs()`, `clearLogs()`                       |
| `auth`   | Makes JWTs: `createToken()`, `createExpiredToken()`, `createInvalidToken()`, `users` (`admin`, `user`, `readOnly`), `getJwks()`, `getIssuer()`, `getAudience()` |

`test.beforeEach()` and `test.afterEach()` receive the same fixtures when their callback takes a parameter.

## Matchers

**Tools**: `toContainTool`, `toBeSuccessful`, `toBeError`, `toHaveTextContent`, `toHaveImageContent`, `toHaveResourceContent`

**Resources**: `toContainResource`, `toContainResourceTemplate`, `toHaveMimeType`

**Prompts**: `toContainPrompt`, `toHaveMessages`

**Protocol**: `toBeValidJsonRpc`, `toHaveResult`, `toHaveError`, `toHaveErrorCode`

**Tool UI**: `toHaveRenderedHtml`, `toContainHtmlElement`, `toContainBoundValue`, `toBeXssSafe`, `toHaveWidgetMetadata`, `toHaveCssClass`, `toNotContainRawContent`, `toHaveProperHtmlStructure`

Use them through the `expect` this package exports, which is Jest's `expect` with these matchers typed. `frontmcp test` and the preset also register them on Jest's global `expect`, through `@frontmcp/testing/setup`, which you can add to `setupFilesAfterEnv` yourself.

## Configuration

```ts
import { test } from '@frontmcp/testing';

test.use({
  server: './src/main.ts', // the entry file, run with tsx
  port: 3003, // default: a free port
  transport: 'streamable-http', // or 'sse'
  entryPath: '/mcp', // if the server sets http.entryPath
  publicMode: true, // send no Authorization header, for auth: { mode: 'public' }
  logLevel: 'debug',
  env: { API_KEY: 'test' },
  startupTimeout: 30_000,
});
```

Call `test.use()` at the top of a file to configure every test in it, or inside `test.describe()` to configure that block, which then gets a server of its own. `baseUrl` tests a server that's already running instead of starting one.

## Other exports

| Export                                                  | Use it to                                                                           |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `McpTestClient`, `TestServer`                           | Start a server and connect a client yourself, without the fixtures                  |
| `TestTokenFactory`, `MockOAuthServer`, `MockCimdServer` | Sign tokens, stand in for an OAuth provider, and serve client ID metadata documents |
| `MockAPIServer`, `httpMock`, `httpResponse`             | Answer the HTTP calls your tools make                                               |
| `mockResponse`, `interceptors`                          | Mock or change MCP requests on the `mcp` client                                     |
| `perfTest`, `LeakDetector`, `MetricsCollector`          | Measure memory and time, and find leaks                                             |

## Docs

- [`@frontmcp/testing`](https://frontmcp.dev/reference/testing): `test`, the `mcp` client, result wrappers and running tests
- [Fixtures](https://frontmcp.dev/reference/testing/fixtures): every `test.use()` option, and the `mcp`, `server` and `auth` fixtures
- [Matchers](https://frontmcp.dev/reference/testing/matchers): what each matcher checks
- [Interceptors and HTTP mocking](https://frontmcp.dev/reference/testing/interceptors): `mcp.mock`, `mcp.intercept`, `MockAPIServer` and `httpMock`
- [Testing authentication](https://frontmcp.dev/reference/testing/auth): tokens, mock OAuth servers and signing in
- [Testing your server](https://frontmcp.dev/learn/testing-your-server): a guided introduction

## Related packages

- [`@frontmcp/sdk`](https://www.npmjs.com/package/@frontmcp/sdk): the framework the servers under test are built with
- [`frontmcp`](https://www.npmjs.com/package/frontmcp): the CLI, whose `frontmcp test` runs your tests
- [`@frontmcp/observability`](https://www.npmjs.com/package/@frontmcp/observability): has `createTestTracer()` to check the spans a test records

## Contributing

Source: [`libs/testing`](https://github.com/agentfront/frontmcp/tree/main/libs/testing). Issues and pull requests are welcome; see [CONTRIBUTING.md](https://github.com/agentfront/frontmcp/blob/main/CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](https://github.com/agentfront/frontmcp/blob/main/LICENSE).
