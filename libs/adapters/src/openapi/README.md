# OpenAPI Adapter

Generate MCP tools directly from an OpenAPI specification. This adapter uses `openapi-mcp-generator` to read a spec (local JSON/YAML or remote URL), then exposes each operation as an MCP tool that your app can call.

- Source: `libs/adapters/src/openapi`
- Demo usage: `apps/demo/src/apps/expenses/index.ts`

## When to use
Use the OpenAPI Adapter when you want to quickly expose a REST API as MCP tools without hand-writing tool functions. The adapter handles:
- Generating input schemas (Zod) from the API spec
- Building request URLs and query strings
- Sending headers and request bodies
- Parsing JSON responses when available

## Installation
The adapter is part of `@frontmcp/adapters`. Import and register it in your app.

## Quick start
```ts
import { App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';

@App({
  id: 'expense',
  name: 'Expense MCP app',
  adapters: [
    OpenapiAdapter.init({
      name: 'backend:api',
      // Provide either 'url' (string) or 'spec' (OpenAPIV3.Document)
      url: process.env.OPENAPI_SPEC_URL!,
      baseUrl: process.env.API_BASE_URL!
    })
  ],
})
export default class ExpenseMcpApp {}
```

This mirrors the example in `apps/demo/src/apps/expenses/index.ts`.

## Options
The adapter accepts a set of options to control tool generation and request execution.

Required:
- `name: string` — Identifier for this adapter instance. Also used to disambiguate tools when multiple adapters are loaded.
- `baseUrl: string` — Base URL for requests (e.g., `process.env.API_BASE_URL`).
- One of:
  - `url: string` — Path or URL to the OpenAPI document (local file or remote).
  - `spec: OpenAPIV3.Document` — An in-memory OpenAPI document.

Common optional fields:
- `additionalHeaders?: Record<string, string>` — Static headers applied to every request.
- `headersMapper?: (authInfo: AuthInfo, headers: Headers) => Headers` — Map authenticated user/session data to headers (e.g., `Authorization`, multi-tenant IDs, etc.).
- `bodyMapper?: (authInfo: AuthInfo, body: any) => any` — Augment/transform the request body before sending.
- `inputSchemaMapper?: (inputSchema: any) => any` — Transform the generated input schema (hide/fill fields, etc.).
- OpenAPI tool generation controls (passed through to `openapi-mcp-generator`):
  - `filterFn?: (op) => boolean`
  - `defaultInclude?: boolean`
  - `excludeOperationIds?: string[]`

## Authentication examples
Add static headers (e.g., API key):
```ts
OpenapiAdapter.init({
  name: 'my-api',
  url: process.env.OPENAPI_SPEC_URL!,
  baseUrl: process.env.API_BASE_URL!,
  additionalHeaders: { 'x-api-key': process.env.MY_API_KEY! }
});
```

Derive headers from the authenticated context:
```ts
OpenapiAdapter.init({
  name: 'my-api',
  url: process.env.OPENAPI_SPEC_URL!,
  baseUrl: process.env.API_BASE_URL!,
  headersMapper: (authInfo, headers) => {
    if (authInfo?.accessToken) headers.set('authorization', `Bearer ${authInfo.accessToken}`);
    if (authInfo?.tenantId) headers.set('x-tenant-id', String(authInfo.tenantId));
    return headers;
  },
});
```

## How it works
- The adapter reads the OpenAPI spec and uses `openapi-mcp-generator` to produce a list of tool definitions.
- Each tool gets an input schema derived from the spec (validated via Zod at runtime).
- At execution time, the adapter composes the request URL, applies query/path/header params, attaches a body when needed, and returns parsed JSON if available.

## Links
- OpenAPI Adapter docs page: `docs/adapters/openapi-adapter.mdx`
- Demo app that uses it: `apps/demo/src/apps/expenses/index.ts`
- Spec used by the demo: https://frontmcp-test.proxy.beeceptor.com/openapi.json
- Generator: https://www.npmjs.com/package/openapi-mcp-generator
