# FrontMCP Adapters

This package contains adapters that extend FrontMCP servers with external capabilities by auto-generating, transforming,
or delegating MCP tools.

## Available adapters

### OpenAPI Adapter

Generate MCP tools from an OpenAPI spec. Each operation becomes an MCP tool with strong input validation and automatic
request/response handling.

- Code: `libs/adapters/src/openapi`
- README: `libs/adapters/src/openapi/README.md`
- Demo usage: `apps/demo/src/apps/expenses/index.ts`
- Example spec (used by the demo): https://frontmcp-test.proxy.beeceptor.com/openapi.json

This adapter is powered by [`mcp-from-openapi`](https://www.npmjs.com/package/mcp-from-openapi) (external package),
which handles parameter conflict resolution, multi-security schemes, and request mappers for you.

Quick example:

```ts
import { OpenapiAdapter } from '@frontmcp/adapters';

OpenapiAdapter.init({
  name: 'backend:api',
  url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
  baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
});
```

For detailed options and advanced usage, see the adapter README and the docs page `docs/adapters/openapi-adapter.mdx`.
