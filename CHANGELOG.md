## [v0.3.0] - 2025-11-15

### feat

- Add typed flow hooks for tool, list, and HTTP pipelines with Will/Stage/Did/Around helpers. (#14)
- Publish the `frontmcp` CLI from the monorepo with dev/build/init/doctor/inspector/create commands. (#16)

### refactor

- **BREAKING** Consolidate the former `@frontmcp/core` package into `@frontmcp/sdk`; update imports to `@frontmcp/sdk`.
  (#15, #33)

### fix

- Stringify JSON request bodies in the OpenAPI adapter to avoid malformed payloads. (#25)

### ci

- Harden release automation for branch creation, publishing, and Codex documentation updates. (#19, #21, #27, #28, #29,
  #30, #33, #36)

## 0.2.5 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.4 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.3 (2025-11-06)

This was a version bump only, there were no code changes.

## 0.2.2 (2025-11-06)

### 680 Features

- **adapters:** add support for inline spec in opanapi adapter ([#13](https://github.com/agentfront/frontmcp/pull/13))

### 979 Fixes

- **core:** fix openapi tool execution ([#12](https://github.com/agentfront/frontmcp/pull/12))

### 764e0f Thank You

- David Antoon @frontegg-david

## 0.2.1 (2025-11-05)

### 680 Features

- **auth:** support no auth DCR (development mode only) ([#11](https://github.com/agentfront/frontmcp/pull/11))

### 764e0f Thank You

- David Antoon @frontegg-david

## 0.2.0 (2025-11-05)

FrontMCP 0.2.0 focuses on a zero-friction developer experience: a project generator, one-command Inspector, smarter
config checks, and ergonomic tool schemas plus a **dev-only no-auth mode** for quick local testing.

- 9ea **Dev-only no-auth**: run without auth _in development mode only_. Example: <code>frontmcp dev --no-auth</code>
- 680 **Project generator**: <code>npx frontmcp create &lt;name&gt;</code> scaffolds tsconfig, package.json scripts, and
  starter files.
- 527 **Init for existing repos**: <code>npx frontmcp init</code> adds scripts and fixes tsconfig automatically.
- 52d **Inspector, zero setup**: <code>frontmcp inspector</code> launches <code>@modelcontextprotocol/inspector</code>.
- 97a **Doctor**: validates Node 0 22, npm 0 10, entry detection, and configuration.
- 728 **Tool schema ergonomics**: pass Zod fields directly (<code>inputSchema: &#123; ... &#125;</code> /
  <code>outputSchema: &#123; ... &#125;</code>).
- 6a1 **Async type checks in dev**: background type-checking while watching files.
- 4e6 **Entry detection & builds**: uses <code>package.json.main</code> or falls back to <code>src/main.ts</code>;
  builds to <code>./dist</code> (override with <code>--out-dir</code>).
- 4e1 **Transport health**: unified SSE intent detection incl. legacy GET <code>event-stream</code> and session-aware
  SSE.
- 4dd **Better logging**: consistent <code>verbose/info/warn/error</code> across flows.

## 0.1.3 (2025-11-05)

### 680 Features

- **adapters:** improve OpenAPI adapter ([#7](https://github.com/agentfront/frontmcp/pull/7))

### 979 Fixes

- **docs:** adjust quick start code ([#8](https://github.com/agentfront/frontmcp/pull/8))

### 764e0f Thank You

- David Antoon @frontegg-david

## 0.1.2 (2025-11-05)

This was a version bump only, there were no code changes.

## 0.1.1 (2025-11-05)

This was a version bump only, there were no code changes.

## 0.1.0 (2025-11-05)

### 680 Features

- **core:** migrate tool call to new the flow runner ([#6](https://github.com/agentfront/frontmcp/pull/6))

### 979 Fixes

- Fix docs and README ([#3](https://github.com/agentfront/frontmcp/pull/3))
- **core:** fix tool listing ([#4](https://github.com/agentfront/frontmcp/pull/4))

### 764e0f Thank You

- David Antoon @frontegg-david
