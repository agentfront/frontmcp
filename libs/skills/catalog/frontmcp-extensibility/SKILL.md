---
name: frontmcp-extensibility
description: 'Extend FrontMCP servers with external npm packages and libraries. Covers VectoriaDB for semantic search, and patterns for integrating third-party services into providers and tools. Use when adding search, ML, database, or external API capabilities beyond the core SDK.'
tags: [extensibility, vectoriadb, search, integration, npm, provider, external-services]
category: extensibility
targets: [all]
bundle: [full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/extensibility/providers
---

# FrontMCP Extensibility

Patterns and examples for extending FrontMCP servers with external npm packages. The core SDK handles MCP protocol, DI, and lifecycle — this skill shows how to integrate third-party libraries as providers and tools.

## When to Use This Skill

### Must Use

- Adding semantic search or similarity matching to your server (VectoriaDB)
- Integrating an external npm package as a FrontMCP provider
- Building tools that wrap third-party services (databases, APIs, ML models)

### Recommended

- Looking for patterns to structure external service integrations
- Deciding between provider-based vs direct integration for a library
- Adding capabilities like applescript automation, VM execution, or data processing

### Skip When

- You need to build core MCP components (see `frontmcp-development`)
- You need to configure auth, transport, or CORS (see `frontmcp-config`)
- You need to write a plugin with hooks and context extensions (see `create-plugin`)

> **Decision:** Use this skill when integrating external libraries into your FrontMCP server as providers or tools.

## Prerequisites

- A FrontMCP project (see `frontmcp-setup` if you don't have one).
- The external library installed as a runtime `dependency` (not `devDependency`).
- Familiarity with FrontMCP providers and tools (see `create-provider`, `create-tool`).

## Steps

1. **Pick the integration shape** — provider for stateful clients (DB, search index), tool-only for stateless one-shot calls.
2. **Wrap the library in a provider** — declare a typed DI token and a `@Provider` class so consumers depend on the boundary, not the library.
3. **Register it** — add to `@App({ providers: [...] })` or `@FrontMcp({ providers: [...] })`.
4. **Expose via tools/resources** — call `this.get(TOKEN)` in `ToolContext`/`ResourceContext`; never import the library directly from the tool.
5. **Handle errors at the boundary** — translate library-specific errors into `PublicMcpError`/`InvalidInputError` so MCP clients see structured failures.

## Scenario Routing Table

| Scenario                                      | Reference                                       | Description                                              |
| --------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Add in-memory semantic search with VectoriaDB | `references/vectoriadb.md`                      | TF-IDF or ML semantic indexing, provider+tool pattern    |
| Load an app from an npm package               | `multi-app-composition` (in frontmcp-setup)     | `App.esm('@scope/pkg@^1.0.0', 'AppName')` pattern        |
| Connect to a remote MCP server                | `multi-app-composition` (in frontmcp-setup)     | `App.remote('https://...', 'ns')` pattern                |
| Build a reusable plugin with hooks            | `create-plugin-hooks` (in frontmcp-development) | `DynamicPlugin`, context extensions, lifecycle hooks     |
| Build a custom adapter for an external source | `create-adapter` (in frontmcp-development)      | `DynamicAdapter` for OpenAPI, GraphQL, or custom sources |
| Auto-generate tools from an OpenAPI spec      | `official-adapters` (in frontmcp-development)   | `OpenapiAdapter` with filtering, auth, and transforms    |

## Integration Pattern

The standard pattern for integrating any external library:

1. **Create a provider** — wraps the library as a singleton or scoped service
2. **Register the provider** — add to `@App({ providers: [...] })` or `@FrontMcp({ providers: [...] })`
3. **Create tools** — expose the provider's capabilities as MCP tools via `this.get(ProviderClass)` (the class itself is the DI token)
4. **Optionally create resources** — expose data as MCP resources with autocompletion

```typescript
// 1. Provider wraps the library (the class itself is the DI token)
@Provider({ name: 'my-search', scope: ProviderScope.GLOBAL })
export class SearchProvider {
  private client: ExternalLibrary;
  constructor() {
    this.client = new ExternalLibrary({
      /* config */
    });
  }
  async search(query: string) {
    return this.client.query(query);
  }
}

// 2. Tool exposes it
@Tool({ name: 'search', inputSchema: { query: z.string() } })
export default class SearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return this.get(SearchProvider).search(input.query);
  }
}
```

## Available Integrations

| Library        | Purpose                          | Reference                  |
| -------------- | -------------------------------- | -------------------------- |
| **VectoriaDB** | In-memory TF-IDF semantic search | `references/vectoriadb.md` |

More integrations can be added as references (e.g., enclave-vm, applescript, database clients).

## Common Patterns

| Pattern              | Correct                                    | Incorrect                                | Why                                                                 |
| -------------------- | ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| Library access       | `this.get(SearchToken)` from a tool        | `import { client } from 'lib'` in a tool | DI boundary lets you swap implementations and test in isolation     |
| Provider scope       | `ProviderScope.GLOBAL` for shared clients  | New instance per request                 | Library clients (DB pools, indices) are expensive to construct      |
| Async initialisation | `onInit()` lifecycle hook on the provider  | Constructor `await`                      | Constructors can't be async; `onInit` is the framework's init seam  |
| Error surfaces       | Throw `PublicMcpError`/`InvalidInputError` | Re-throw raw library errors              | Library stack traces leak internals and aren't JSON-RPC error-coded |

## Verification Checklist

- [ ] External library is in `dependencies` (not `devDependencies`)
- [ ] Provider wraps the library with proper initialization and cleanup
- [ ] Provider class is listed in `@App` or `@FrontMcp` `providers: [...]` array (the class itself is the DI token)
- [ ] Tools use `this.get(ProviderClass)` to access the provider (not direct imports)
- [ ] Error handling wraps library-specific errors into MCP error classes

## Troubleshooting

| Problem                                      | Cause                                                          | Solution                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Cannot find module '<lib>'` at runtime      | Library declared as `devDependency` only                       | Move to `dependencies`; rebuild the bundle if deploying as MCPB/CLI                                                     |
| Provider constructed once per request        | Default scope used; expensive client recreated each call       | Set `scope: ProviderScope.GLOBAL` on the `@Provider` decorator                                                          |
| Tool sees `undefined` from `this.get(TOKEN)` | Provider not registered in the active `@App`/`@FrontMcp` scope | Add the provider class to the scope's `providers: [...]` array                                                          |
| Browser build fails with Node-only library   | Library uses `node:` modules not available at the target       | Gate behind `availableWhen.platform`, or move the integration into a server-only app and call it via a remote transport |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `vectoriadb`

| Example                                                                                         | Level        | Description                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`product-catalog-search`](./examples/vectoriadb/product-catalog-search.md)                     | Advanced     | Shows advanced VectoriaDB usage with typed document metadata, batch operations, filtered search by multiple criteria, and batch indexing of a product catalog. |
| [`semantic-search-with-persistence`](./examples/vectoriadb/semantic-search-with-persistence.md) | Intermediate | Shows how to use `VectoriaDB` for semantic search with transformer models, filtered search, and `FileStorageAdapter` for persistence across restarts.          |
| [`tfidf-keyword-search`](./examples/vectoriadb/tfidf-keyword-search.md)                         | Basic        | Shows how to use `TFIDFVectoria` for zero-dependency keyword search in a FrontMCP provider, with field weights and index building.                             |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-extensibility/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                                    |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-extensibility`, `frontmcp skills read frontmcp-extensibility:references/<file>.md`, `frontmcp skills install frontmcp-extensibility` — no server required.                                                                                                                                             |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-extensibility/SKILL.md`, `skill://frontmcp-extensibility/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- Related skills: `create-provider`, `create-tool`, `frontmcp-development`
