# Transport Protocol Presets Reference

## Preset Configurations

### `'legacy'` (Default)

Maximum compatibility with all MCP clients including older versions.

```typescript
{ sse: true, streamable: true, json: false, stateless: false, legacy: true, strictSession: true }
```

### `'modern'`

Modern protocol only. Drops legacy SSE support.

```typescript
{ sse: true, streamable: true, json: false, stateless: false, legacy: false, strictSession: true }
```

### `'stateless-api'`

No sessions. Pure request/response for serverless.

```typescript
{ sse: false, streamable: false, json: false, stateless: true, legacy: false, strictSession: false }
```

### `'full'`

All protocols enabled. Maximum flexibility.

```typescript
{ sse: true, streamable: true, json: true, stateless: true, legacy: true, strictSession: false }
```

## Protocol Fields

| Field           | Description          | Effect when `true`                                    |
| --------------- | -------------------- | ----------------------------------------------------- |
| `sse`           | SSE endpoint         | Enables `/sse` endpoint for server-sent events        |
| `streamable`    | Streamable HTTP POST | Enables streaming responses via HTTP POST             |
| `json`          | JSON-only responses  | Returns complete JSON without streaming               |
| `stateless`     | Stateless HTTP       | No session management, each request standalone        |
| `legacy`        | Legacy SSE transport | Backwards-compatible SSE for older clients            |
| `strictSession` | Require session ID   | Streamable HTTP POST requires `mcp-session-id` header |

## Deployment Recommendations

| Deployment                | Preset                         | Why                                       |
| ------------------------- | ------------------------------ | ----------------------------------------- |
| Node.js (single instance) | `'legacy'`                     | Max compatibility, simple setup           |
| Node.js (load balanced)   | `'modern'` + Redis persistence | Modern protocol with distributed sessions |
| Vercel                    | `'stateless-api'`              | No persistent connections allowed         |
| AWS Lambda                | `'stateless-api'`              | Stateless execution model                 |
| Cloudflare Workers        | `'stateless-api'`              | Stateless edge runtime                    |
| Development               | `'full'`                       | Test all protocols                        |
