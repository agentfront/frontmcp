## [v0.6.0] - 2025-12-19

### feat

- Move transport and session controls into the new top-level `transport` block with redis-backed persistence, platform detection, and per-app overrides.
- Extend `frontmcp create` with serverless targets and ship ready-made wrappers for Vercel, AWS Lambda, and Cloudflare Workers.
- Add `FrontMcpContext` helpers plus CONTEXT-scoped providers so request IDs, tracing, and auth metadata are accessible inside every tool, resource, and hook.
- Publish a comprehensive `apps/e2e` workspace (public auth, CodeCall, cache, notifications, hooks, OpenAPI, providers, multi-app) complete with Nx serve targets and Jest suites.
- Upgrade the UI renderer with universal and dual-payload output, safer structured content handling, and resilient clientInfo/platform detection.

### fix

- Treat `zod`, `react`, and `react-dom` as peerDependencies across packages to avoid duplicate installs and version drift.
- Tighten transport/session recreation by validating session IDs, sanitizing inputs, and deleting corrupted Redis payloads before reuse.
- Harden templated UI and Markdown rendering with stricter escaping, URL validation, and CSP guards to block XSS vectors.

### docs

- Document the new top-level transport/redis config, request-context APIs, and migration steps in the server and extensibility guides.
- Refresh the CodeCall CRM demo and testing overview to point at the `apps/e2e` samples and their Jest suites.
- Expand the serverless deployment guide with CLI target flags, generated config files, and per-platform notes.

### build

- Add Docker assets, multi-stage builds, and Redis setup scripts so generated projects can run locally or in CI without manual tweaks.
- Improve the release pipeline by iterating dist folders for Verdaccio publishes and keeping Nx release commands in sync with lockfiles.

### ci

- Enhance the e2e workflow with retry logic, Nx run-many batching, `--forceExit`, and a dedicated debug workflow for UI transport tests.

## [v0.5.1] - 2025-12-12

### feat

- Scaffold new projects with `zod@^4.0.0` so freshly generated apps match the runtime upgrade without manual edits.

### docs

- Promote the tool UI metadata, resource widget guide, and VectoriaDB 2.x installation guidance to the live Mintlify docs and navigation.
- Point README branding assets at absolute GitHub URLs so logos render reliably on npm and other mirrors.

### build

- Align every synchronized package with `@modelcontextprotocol/sdk 1.24.3`, `vectoriadb ^2.0.1`, `enclave-vm ^1.0.3`, and `esbuild 0.27.1` for consistent installs.
- Trim the global `frontmcp` CLI dependencies down to `tslib` so it reuses your workspace SDK, adapter, and plugin versions.

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

- **core:** fix openapi tool execution ([#12](https://git
