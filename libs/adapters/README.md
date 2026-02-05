# @frontmcp/adapters

Adapters that extend FrontMCP servers by auto-generating MCP tools from external specifications.

[![NPM](https://img.shields.io/npm/v/@frontmcp/adapters.svg)](https://www.npmjs.com/package/@frontmcp/adapters)

## Install

```bash
npm install @frontmcp/adapters
```

## Available Adapters

### OpenAPI Adapter

Generate MCP tools from an OpenAPI spec. Each operation becomes a tool with Zod input validation and automatic request/response handling.

```ts
import { App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  id: 'my-app',
  name: 'My App',
  adapters: [
    OpenapiAdapter.init({
      name: 'backend:api',
      url: 'https://api.example.com/openapi.json',
      baseUrl: 'https://api.example.com',
    }),
  ],
})
export default class MyApp {}
```

Powered by [`mcp-from-openapi`](https://www.npmjs.com/package/mcp-from-openapi) for parameter conflict resolution, multi-security schemes, and request mappers.

> Full guide: [OpenAPI Adapter][docs-openapi]

## Docs

| Topic              | Link                               |
| ------------------ | ---------------------------------- |
| Adapters overview  | [Adapters Overview][docs-overview] |
| OpenAPI adapter    | [OpenAPI Adapter][docs-openapi]    |
| Step-by-step guide | [Add OpenAPI Adapter][docs-guide]  |

## Related Packages

- [`@frontmcp/sdk`](../sdk) — core framework
- [`@frontmcp/testing`](../testing) — E2E testing for adapter-generated tools
- [`mcp-from-openapi`](https://www.npmjs.com/package/mcp-from-openapi) — underlying OpenAPI-to-MCP engine

## License

Apache-2.0 — see [LICENSE](../../LICENSE).

<!-- links -->

[docs-overview]: https://docs.agentfront.dev/frontmcp/adapters/overview
[docs-openapi]: https://docs.agentfront.dev/frontmcp/adapters/openapi-adapter
[docs-guide]: https://docs.agentfront.dev/frontmcp/guides/add-openapi-adapter
