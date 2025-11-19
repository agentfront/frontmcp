# __OWNER__/__SERVICE__ FrontMCP integration

This folder was generated from the `3rd-party-integration` template.

- Owner: `__OWNER__`
- Service: `__SERVICE__`
- Default auth type: `__AUTH_TYPE__`

## Purpose

This template is meant for community-contributed tools that integrate a third-party API
into an existing FrontMCP server.

You can define tools in **two ways**:

1. **JSON tools** under `tools/json/*.json`
  - Strict JSON structure validated by `mcp-json-tool.schema.json`.
  - Input is described by JSON Schema.
  - Request mapping from MCP input / auth / context → HTTP request (method, path, headers, body).
  - Output mapping from HTTP response → `{ status, headers, body }`.

2. **TypeScript tools** under `src/tools/*.ts`
  - Must export an `execute` function.
  - Must use the shared types from `src/mcp-http-types.ts`.
  - Intended for more complex cases (multiple requests, complex mapping, conditional flows).

## Standard HTTP output shape

All tools (JSON or TS) are expected to produce the same shape:

```ts
{
  status: number;                    // HTTP status code
  headers?: Record<string, string>;  // response headers
  body: any;                         // mapped payload (tool-specific)
}
