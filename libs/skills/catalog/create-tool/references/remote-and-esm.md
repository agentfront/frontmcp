---
name: remote-and-esm
description: Tool.esm / Tool.remote — load tools from ESM URLs or remote MCP servers.
---

# Remote and ESM tools

Two ways to register tools you don't ship directly in your codebase:

## `Tool.esm(...)` — ESM URL

Loads a tool implementation from an ES module published to npm or hosted on a CDN.

```typescript
const RemoteTool = Tool.esm('@my-org/tools@^1.0.0', 'MyTool', {
  description: 'A tool loaded from an ES module',
});

@App({ name: 'main', tools: [RemoteTool] })
class MainApp {}
```

| Arg          | Purpose                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `specifier`  | npm package + optional semver range (`'@my-org/tools@^1.0.0'`) OR a full URL (`'https://esm.sh/@acme/widget@2.1.0'`) |
| `exportName` | Named export to load from the module                                                                                 |
| `options`    | Optional override for description / annotations / throttling — the module's defaults are used otherwise              |

The framework loads the module at server startup. Compatibility tip: the loaded module should export a `@Tool`-decorated class or a `tool({...})(handler)` value.

## `Tool.remote(...)` — remote MCP server

Proxies a tool from another MCP server. Tool calls hop through your server to the remote.

```typescript
const CloudTool = Tool.remote('https://example.com/tools/cloud-tool', 'CloudTool', {
  description: 'A tool loaded from a remote MCP server',
});

@App({ name: 'main', tools: [CloudTool] })
class MainApp {}
```

| Arg         | Purpose                                    |
| ----------- | ------------------------------------------ |
| `serverUrl` | Remote MCP server URL                      |
| `toolName`  | The remote tool's `name`                   |
| `options`   | Local overrides (description, annotations) |

The framework establishes a long-lived connection to the remote server at startup and re-uses it for every call. Auth headers from your server's session can be forwarded — configure via the remote-server registration in `@FrontMcp({ remoteServers: [...] })`.

## When to use

| Pattern                      | When                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `@Tool` (class in your code) | Your tool, your code. The default.                                                         |
| `Tool.esm(...)`              | Third-party tool packages, internal monorepo tools served via a CDN, shared tool libraries |
| `Tool.remote(...)`           | Federation — your server exposes a tool that physically lives on another MCP server        |

## Limitations

- **`Tool.esm`**: the loaded module runs in the same Node process. You inherit its dependencies. Pin versions; don't `^` against untrusted modules.
- **`Tool.remote`**: a remote outage means the proxied tool fails. Pair with `timeout` and consider a fallback. Auth headers may or may not be forwarded depending on your federation config.

## See also

- [`registration.md`](./registration.md)
- [`decorator-options.md`](./decorator-options.md)
