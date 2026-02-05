# @frontmcp/testing

E2E testing framework for FrontMCP servers.

[![NPM](https://img.shields.io/npm/v/@frontmcp/testing.svg)](https://www.npmjs.com/package/@frontmcp/testing)

## Install

```bash
npm install -D @frontmcp/testing
```

Peer dependencies: `@frontmcp/sdk`, `jest`, `@jest/globals`. Optional: `@playwright/test` (for browser OAuth flow testing).

## Quick Start

```ts
import { test, expect } from '@frontmcp/testing';
import MyServer from './src/main';

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

```bash
npx frontmcp test
```

The library handles server startup, MCP client connection, test execution, and cleanup.

## Fixtures

| Fixture  | Description                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------- |
| `mcp`    | Auto-connected MCP client — tools, resources, prompts, raw protocol, notifications, logs              |
| `server` | Server control — `createClient()`, `restart()`, `onHook()`, `getLogs()`                               |
| `auth`   | Token factory — `createToken()`, `createExpiredToken()`, `createInvalidToken()`, pre-built test users |

## Custom Matchers

**Tools** — `toContainTool`, `toBeSuccessful`, `toBeError`, `toHaveTextContent`, `toHaveImageContent`, `toHaveResourceContent`

**Resources** — `toContainResource`, `toContainResourceTemplate`, `toHaveMimeType`

**Prompts** — `toContainPrompt`, `toHaveMessages`, `toHaveRole`, `toContainText`

**Protocol** — `toBeValidJsonRpc`, `toHaveResult`, `toHaveError`, `toHaveErrorCode`

**Tool UI** — `toHaveRenderedHtml`, `toContainHtmlElement`, `toContainBoundValue`, `toBeXssSafe`, `toHaveWidgetMetadata`, `toHaveCssClass`, `toNotContainRawContent`, `toHaveProperHtmlStructure`

## Configuration

```ts
test.use({
  server: MyServer,
  port: 3003, // default: auto
  transport: 'streamable-http', // or 'sse'
  auth: { mode: 'public' },
  logLevel: 'debug',
  env: { API_KEY: 'test' },
});
```

## Docs

| Topic              | Link                              |
| ------------------ | --------------------------------- |
| Getting started    | [Testing Overview][docs-overview] |
| Testing tools      | [Tools][docs-tools]               |
| Testing Tool UI    | [Tool UI][docs-tool-ui]           |
| Testing resources  | [Resources][docs-resources]       |
| Testing prompts    | [Prompts][docs-prompts]           |
| Testing auth       | [Authentication][docs-auth]       |
| Testing transports | [Transports][docs-transports]     |
| HTTP mocking       | [HTTP Mocking][docs-mocking]      |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/ui`](../ui) — UI components tested with `toHaveRenderedHtml` and friends

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/testing/overview
[docs-tools]: https://docs.agentfront.dev/frontmcp/testing/tools
[docs-tool-ui]: https://docs.agentfront.dev/frontmcp/testing/tool-ui
[docs-resources]: https://docs.agentfront.dev/frontmcp/testing/resources
[docs-prompts]: https://docs.agentfront.dev/frontmcp/testing/prompts
[docs-auth]: https://docs.agentfront.dev/frontmcp/testing/authentication
[docs-transports]: https://docs.agentfront.dev/frontmcp/testing/transports
[docs-mocking]: https://docs.agentfront.dev/frontmcp/testing/http-mocking
