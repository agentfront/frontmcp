## [v0.5.0] - 2025-12-11

### feat

- Ship @frontmcp/ui with HTML, React, and MDX templates, platform detection, HTMX hooks, and consent/error layouts so tools can return polished UI anywhere.
- Expose Tool UI metadata (display modes, serving modes, widget accessibility, CSP, hydration) plus OpenAI App SDK resource widgets for richer tool responses.
- Implement public, transparent, and orchestrated authentication modes with consent screens, incremental scopes, session strategies, and runnable Nx demo servers.
- Add first-class MCP resource and prompt registries, `@ResourceTemplate` execution, capability notifications, and improved error handling across transports.
- Deliver the CodeCall plugin, VectoriaDB semantic store, AST Guard, sandbox upgrades, and tool-owner enforcement to harden plugin execution.
- Introduce @frontmcp/testing with Jest integration, HTTP mocking, fixtures, and e2e helpers for deterministic transport coverage.

### docs

- Expand Mintlify docs with platform-aware UI guides, authentication mode walkthroughs, CodeCall/Vectoria/AST Guard guides, testing references, and refreshed navigation for v0.5.

### build

- Require Node >= 22 (tested on 24), bump @types/node to 24, upgrade to MCP SDK 1.23, Zod 4, add @huggingface/transformers + zod-from-json-schema, and align Nx tooling + engine metadata.
- Streamline CI by skipping CUDA for ONNX validator installs and tightening SWC/Jest configs across packages.

## [v0.4.0] - 2025-11-22

### feat

- Publish the standalone `mcp-from-openapi` generator and wire the OpenAPI adapter to it so every tool inherits request mappers, conflict-free schemas, and per-scheme authentication analysis.
- Allow `@Tool` metadata to declare literal primitives, tuple-style arrays, and MCP resources (plus `rawInputSchema`) so clients get typed responses without wrapping outputs in placeholder objects.
- Add a typed MCP error hierarchy and error handler so transports emit traceable IDs, consistent public/internal messages, and FlowControl-aware stop semantics.
- Extract `json-schema-to-zod-v3` with built-in regex guards so adapters and apps can reuse the hardened JSON Schema → Zod converter.

### docs

- Document OpenAPI adapter security scoring, auth-provider mapping, generator options, and the CodeCall plugin’s search/describe/execute workflow.
- Publish maintainer runbooks for the release workflow and doc versioning so contributors know when to edit draft vs live docs.

### build

- Split draft/live Mintlify trees, auto-archive previous minors, and enforce husky + lint-staged guards so release branches stay focused on intentional changes.

## [v0.3.1] - 2025-11-16

### feat

- Support split-by-app deployments with scoped base paths so per-app auth providers and transports work without
  collisions.
- Expand the demo workspace with calculator and employee time-tracking sample apps to showcase scoped tooling.

### fix

- Prefix the `/message` SSE endpoint with each app scope to keep split-by-app event streams working.

### docs

- Version the Mintlify docs per minor, refresh branding, and wire the navigation for v0.3.
- Clarify split-by-app auth setup and examples in the 0.3 documentation.

## [v0.3.0] - 2025-11-15

### feat

- Expose `FlowHooksOf(...)` helpers so custom hooks can target Will/Did/Around stages across HTTP, transport, auth, and
  tool flows.
- Ship the Cache plugin with memory and Redis stores plus per-tool TTL and sliding-window refresh controls.

### fix

- Stringify JSON request bodies before issuing OpenAPI adapter requests so downstream APIs receive valid
  `application/json`.

### docs

- Document flow hook customization and cache configuration in the Mintlify guides and plugin references.

### build

- Force the npm registry URL and run publish workflows through the dedicated script to stabilize releases.

## 0.2.5 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.4 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.3 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.2 (2025-11-06)

### 🚀 Features

- **adapters:** add support for inline spec in opanapi adapter ([#13](https://github.com/agentfront/frontmcp/pull/13))

### 🩹 Fixes

- **core:** fix openapi tool execution ([#12](https://github.com/agentfront/frontmcp/pull/12))

### ❤️ Thank You

- David Antoon @frontegg-david

## 0.2.1 (2025-11-05)

### 🚀 Features

- **auth:** support no auth DCR (development mode only) ([#11](https://github.com/agentfront/frontmcp/pull/11))

### ❤️ Thank You

- David Antoon @frontegg-david

## 0.2.0 (2025-11-05)

FrontMCP 0.2.0 focuses on a zero-friction developer experience: a project generator, one-command Inspector, smarter
config checks, and ergonomic tool schemas—plus a **dev-only no-auth mode** for quick local testing.

- 🧪 **Dev-only no-auth**: run without auth _in development mode only_. Example: <code>frontmcp dev --no-auth</code>
- 🚀 **Project generator**: <code>npx frontmcp create &lt;name&gt;</code> scaffolds tsconfig, package.json scripts, and
  starter files.
- 🔧 **Init for existing repos**: <code>npx frontmcp init</code> adds scripts and fixes tsconfig automatically.
- 🔭 **Inspector, zero setup**: <code>frontmcp inspector</code> launches <code>@modelcontextprotocol/inspector</code>.
- 🩺 **Doctor**: validates Node ≥ 22, npm ≥ 10, entry detection, and configuration.
- ✨ **Tool schema ergonomics**: pass Zod fields directly (<code>inputSchema: &#123; ... &#125;</code> /
  <code>outputSchema: &#123; ... &#125;</code>).
- ⚡ **Async type checks in dev**: background type-checking while watching files.
- 📦 **Entry detection & builds**: uses <code>package.json.main</code> or falls back to <code>src/main.ts</code>; builds
  to <code>./dist</code> (override with <code>--out-dir</code>).
- 📡 **Transport health**: unified SSE intent detection incl. legacy GET <code>event-stream</code> and session-aware
  SSE.
- 📝 **Better logging**: consistent <code>verbose/info/warn/error</code> across flows.

## 0.1.3 (2025-11-05)

### 🚀 Features

- **adapters:** improve OpenAPI adapter ([#7](https://github.com/agentfront/frontmcp/pull/7))

### 🩹 Fixes

- **docs:** adjust quick start code ([#8](https://github.com/agentfront/frontmcp/pull/8))

### ❤️ Thank You

- David Antoon @frontegg-david

## 0.1.2 (2025-11-05)

This was a version bump only, there were no code changes.

## 0.1.1 (2025-11-05)

This was a version bump only, there were no code changes.

## 0.1.0 (2025-11-05)

### 🚀 Features

- **core:** migrate tool call to new the flow runner ([#6](https://github.com/agentfront/frontmcp/pull/6))

### 🩹 Fixes

- Fix docs and README ([#3](https://github.com/agentfront/frontmcp/pull/3))
- **core:** fix tool listing ([#4](https://github.com/agentfront/frontmcp/pull/4))

### ❤️ Thank You

- David Antoon @frontegg-david
