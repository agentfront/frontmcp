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

## Scenario Routing Table

| Scenario                                      | Reference                                       | Description                                              |
| --------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Add in-memory semantic search with VectoriaDB | `references/vectoriadb.md`                      | TF-IDF indexing, field weighting, provider+tool pattern  |
| Load an app from an npm package               | `multi-app-composition` (in frontmcp-setup)     | `App.esm('@scope/pkg@^1.0.0', 'AppName')` pattern        |
| Connect to a remote MCP server                | `multi-app-composition` (in frontmcp-setup)     | `App.remote('https://...', 'ns')` pattern                |
| Build a reusable plugin with hooks            | `create-plugin-hooks` (in frontmcp-development) | `DynamicPlugin`, context extensions, lifecycle hooks     |
| Build a custom adapter for an external source | `create-adapter` (in frontmcp-development)      | `DynamicAdapter` for OpenAPI, GraphQL, or custom sources |
| Auto-generate tools from an OpenAPI spec      | `official-adapters` (in frontmcp-development)   | `OpenapiAdapter` with filtering, auth, and transforms    |

## Integration Pattern

The standard pattern for integrating any external library:

1. **Create a provider** — wraps the library as a singleton or scoped service
2. **Register the provider** — add to `@App({ providers: [...] })` or `@FrontMcp({ providers: [...] })`
3. **Create tools** — expose the provider's capabilities as MCP tools via `this.get(TOKEN)`
4. **Optionally create resources** — expose data as MCP resources with autocompletion

```typescript
// 1. Provider wraps the library
@Provider({ name: 'my-search', provide: SearchToken, scope: ProviderScope.GLOBAL })
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
    return this.get(SearchToken).search(input.query);
  }
}
```

## Available Integrations

| Library        | Purpose                          | Reference                  |
| -------------- | -------------------------------- | -------------------------- |
| **VectoriaDB** | In-memory TF-IDF semantic search | `references/vectoriadb.md` |

More integrations can be added as references (e.g., enclave-vm, applescript, database clients).

## Verification Checklist

- [ ] External library is in `dependencies` (not `devDependencies`)
- [ ] Provider wraps the library with proper initialization and cleanup
- [ ] Provider is registered in `@App` or `@FrontMcp` with a typed DI token
- [ ] Tools use `this.get(TOKEN)` to access the provider (not direct imports)
- [ ] Error handling wraps library-specific errors into MCP error classes

## Reference

- Related skills: `create-provider`, `create-tool`, `frontmcp-development`
