---
name: remote-and-esm
description: Tool.esm / Tool.remote — load tools from npm packages or remote MCP servers.
---

# Remote and ESM tools

Two ways to register tools you don't ship directly in your codebase:

## `Tool.esm(...)` — npm package

Loads one named tool from an ES module published to npm (fetched through esm.sh, or the CDN set in `loader`).

```typescript
const EchoTool = Tool.esm('@my-org/tools@^1.0.0', 'echo', {
  metadata: { description: 'Echo tool from @my-org/tools' },
});

@App({ name: 'main', tools: [EchoTool] })
class MainApp {}
```

| Arg          | Purpose                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `specifier`  | npm package + optional semver range or tag (`'@my-org/tools@^1.0.0'`, `'my-tools@latest'`). URLs are rejected.                             |
| `targetName` | The `name` of the tool to take from the package                                                                                            |
| `options`    | Optional `{ loader, cacheTTL, metadata }` — `loader` overrides the registry/CDN, `metadata` overrides the tool's metadata (`description`…) |

The framework loads the module at server startup. Compatibility tip: the loaded module should export a `@Tool`-decorated class or a `tool({...})(handler)` value.

## `Tool.remote(...)` — remote MCP server

Proxies a tool from another MCP server. Tool calls hop through your server to the remote.

```typescript
const SearchTool = Tool.remote('https://api.example.com/mcp', 'search', {
  remoteAuth: { mode: 'forward' },
  metadata: { description: 'Search tool from the API server' },
});

@App({ name: 'main', tools: [SearchTool] })
class MainApp {}
```

| Arg          | Purpose                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `url`        | Remote MCP server endpoint                                                                                                             |
| `targetName` | The remote tool's `name`                                                                                                               |
| `options`    | Optional `{ transportOptions, remoteAuth, metadata }` — timeout/retries/headers, how to authenticate to the remote, metadata overrides |

The framework establishes a long-lived connection to the remote server at startup and re-uses it for every call. To forward the caller's token to the remote, set `remoteAuth: { mode: 'forward' }`; `{ mode: 'static', credentials }` sends fixed credentials instead.

## When to use

| Pattern                      | When                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `@Tool` (class in your code) | Your tool, your code. The default.                                                         |
| `Tool.esm(...)`              | Third-party tool packages, internal monorepo tools served via a CDN, shared tool libraries |
| `Tool.remote(...)`           | Federation — your server exposes a tool that physically lives on another MCP server        |

## Limitations

- **`Tool.esm`**: the loaded module runs in the same Node process. You inherit its dependencies. Pin versions; don't `^` against untrusted modules.
- **`Tool.remote`**: a remote outage means the proxied tool fails. Pair with `transportOptions.timeout` and consider a fallback. The caller's token is forwarded only with `remoteAuth: { mode: 'forward' }`.

## See also

- [`registration.md`](./registration.md)
- [`decorator-options.md`](./decorator-options.md)
