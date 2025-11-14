## [v0.2.6] - 2025-11-14

### Breaking changes

- **BREAKING:** Fold `@frontmcp/core` into `@frontmcp/sdk`; update imports to consume runtime APIs directly from the SDK
  (#15).
- **BREAKING:** Replace legacy flow hook decorators with typed `FlowHooksOf(...).Will/Did/Around` helpers and the
  `ToolHook`, `ListToolsHook`, and `HttpHook` exports (#14).

### Features

- Add typed lifecycle hook registry and helpers to short-circuit tool, list-tools, and HTTP flows with priorities and
  filters (#14).
- Allow the OpenAPI adapter to generate tools from inline `spec` documents as well as remote URLs (#13).
- Publish the `frontmcp` CLI from this repository with dev, build, init, doctor, inspector, and create commands (#16).

### Build/CI

- Automate release branches, trusted publishing, and Codex-driven documentation updates with new workflows (#16, #18,
  #19, #20, #21).

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
