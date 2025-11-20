## [v0.4.0] - 2025-11-20

### feat

- Replace the OpenAPI adapter backend with the new `mcp-from-openapi` generator so every tool inherits request mappers,
  security validation, parameter conflict resolution, and naming controls.
- Let `@Tool` output schemas use literal primitives, resource descriptors, or tuple-style arrays to tighten typing and
  emit structured responses without wrapping objects.

### docs

- Document the OpenAPI adapter's authentication strategies, mapper behavior, and configuration knobs, and refresh the
  tools reference to cover the new schema ergonomics.

### build

- Update publish-on-next-close to separate synchronized vs independent libraries, bump versions, rebuild after bumps,
  remove draft blog cards, and push the release commit automatically.
- Add lint-staged via husky and a push workflow that blocks committing local docs backups to keep releases clean.

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
