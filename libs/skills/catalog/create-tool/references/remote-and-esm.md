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

The server loads the package at startup, before it serves requests, and registers the tool under its own name (`echo`, no namespace prefix). `metadata` is laid over the loaded metadata; a new `name` renames the tool and calls still run the package's `echo`. The package must provide the tool as a `@Tool`-decorated class or a plain `{ name, description?, inputSchema?, execute }` object, in its default-export manifest or as named exports.

A package specifier string in `tools` registers every tool of the package: `tools: ['@my-org/tools@^1.0.0']`.

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

The server connects at startup, before it serves requests, and registers a proxy under the remote tool's own name (`search`, no namespace prefix). Calls hop through your server's `tools:call-tool` flow to the remote. To forward the caller's token to the remote, set `remoteAuth: { mode: 'forward' }`; `{ mode: 'static', credentials }` sends fixed credentials instead.

## Loading rules (both)

- **One load per package, one connection per URL.** Entries naming the same package with the same `loader` and `cacheTTL` (in any `tools`, `resources` or `prompts` array of the server) share one load; entries naming the same URL with the same `transportOptions` and `remoteAuth` share one connection. A `.remote()` entry is what the server listed at startup: unlike `App.remote()`, it is not re-discovered when the server's entries change.
- **Owner.** The tool belongs to the app (or server) whose `tools` lists it, so that owner's hooks, plugins, `authorities` and `availableWhen` apply.
- **Startup errors, never skips.** `ExternalEntryLoadError` when the package does not load or the server is unreachable; `ExternalEntryNotFoundError` when it has no tool with that name (the message lists the tools it has).
- **Same for resources and prompts.** `Resource.esm/remote` and `Prompt.esm/remote` follow these rules. `Agent`, `Skill` and `Job` `.esm()` / `.remote()` are refused at startup with `ExternalEntryNotSupportedError`; declare those locally.

## When to use

| Pattern                      | When                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `@Tool` (class in your code) | Your tool, your code. The default.                                                         |
| `Tool.esm(...)`              | Third-party tool packages, internal monorepo tools served via a CDN, shared tool libraries |
| `Tool.remote(...)`           | Federation — your server exposes a tool that physically lives on another MCP server        |

## Limitations

- **`Tool.esm`**: the loaded module runs in the same Node process. You inherit its dependencies. Pin versions; don't `^` against untrusted modules.
- **`Tool.remote`**: the remote must be reachable at startup. A later outage means the proxied tool fails; pair it with `transportOptions.timeout` and consider a fallback. The caller's token is forwarded only with `remoteAuth: { mode: 'forward' }`.
- **Startup-only:** these entries cannot be added later (an adapter's `replaceAll()` refuses them).

## See also

- [`registration.md`](./registration.md)
- [`decorator-options.md`](./decorator-options.md)
