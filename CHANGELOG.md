## [v0.7.0] - 2026-01-09

### feat

- Orchestrate remote MCP servers through gateway proxies for tools, resources, and prompts while orchestrator agents and resilient transport settings keep cross-server flows predictable.
- Expand plugin and memory tooling with scoped plugin controls, the new Approval Plugin (PKCE/webhook guards), and upgraded DI helpers so approvals and cleanup span Redis, Vercel KV, and Upstash stores.
- Enhance agent tooling with built-in orchestrator, echo, and calculator examples plus progress notifications that auto-update with tokens for longer-running work.
- Consolidate the @frontmcp/utils library around TTL/pattern validation, safe URI templates, and storage adapters for memory, Redis, Vercel KV, and Upstash so caching and approvals stay predictable.

### fix

- Normalize demo and e2e logging to `LogLevel.Verbose` so servers rely on the exported enum names instead of the deprecated `VERBOSE` constant.

### docs

- Document remote orchestration, the Approval Plugin, memory-management helpers, and the @frontmcp/utils storage helpers so gateways, approvals, and caches are easy to configure.

### build

- Add Nx scripts for unit/e2e runs plus coverage merging/check commands and new Jest coverage presets so aggregated stats stay accurate across suites.

## [v0.6.3] - 2025-12-27

### feat

- Introduce recreateable streamable HTTP and SSE transports plus `LocalTransporter.markAsInitialized` so session recovery can rebuild streamable sessions after restarts with the correct MCP SDK state.
- Harden session persistence metadata with fingerprint logging, optional HMAC signing, rate limiting, and max-lifetime guards so stored sessions reject tampered tokens while still surfacing warnings for mismatches.
- Ship UI bundler preflight guidance and lazy `esbuild` loading so component compilation surfaces a clear missing-compiler error and sanitizes absolute paths when widgets fail to build.

### fix

- `TransportService.getStoredSession` now enforces fingerprint checks, respects `warnOnFingerprintMismatch`, and marks recreated streamable transports as initialized so clients do not repeat the handshake.
- The SSE and streamable HTTP adapters use the new recreateable helpers without destroying transports on `onsessionclosed`, keeping stored sessions available for reconnection.

### docs

- Add the Session Recovery and UI Bundler Preflight guides plus navigation entries so operators can find persistence, security, and bundler guidance quickly.

### build

- Align synchronized packages (SDK, CLI, adapters, `@frontmcp/ui`, `@frontmcp/uipack`, and `@frontmcp/testing`) at v0.6.3 with shared dual CJS/ESM exports and sanitized bundler helpers.

## [v0.6.2] - 2025-12-24

### feat

- Add static, dynamic, and hybrid UI build modes plus multi-platform bundling helpers so the same widget can hydrate differently on OpenAI, Claude, or Gemini without duplicate code.
- Auto-enable transport persistence whenever `redis` is configured, wiring session storage without needing a separate `transport.persistence` block.
- Teach `frontmcp build --adapter vercel` to detect npm, pnpm, yarn, or bun lockfiles, set the matching install/build commands, and emit Vercel Build Output API artifacts ready for deployment.

### fix

- Resolve dual-package hazards by lazily requiring `FrontMcpInstance` inside the decorator so runtime imports always reference the same module copy.
- Default primary-auth transport options now reuse `DEFAULT_TRANSPORT_CONFIG`, eliminating drift between schema defaults and runtime behavior.
- Serverless bundling loosens fully-specified import requirements, aliases optional React dependencies, and filters known rspack warnings so builds stay quiet but accurate.

### build

- All synchronized workspaces (sdk, cli, adapters, plugins) now publish dual CommonJS/ESM artifacts with `sideEffects: false` and shared typings for better tree-shaking.

### docs

- Published the Build Modes guide plus a new callout on the platforms page to explain when to reach for static, dynamic, or hybrid rendering.

## [v0.6.1] - 2025-12-22

### feat

- Add Vercel KV as a first-class storage provider with hybrid Redis/pub-sub support so session stores, cache plugins, and inspectors work on Vercel without running your own Redis cluster.
- Split the UI stack into `@frontmcp/ui` for widgets/components and `@frontmcp/uipack` for theming, build utilities, and template types so HTML-first projects no longer pull in React by default.
- Let the Cache Plugin reuse whichever global store you already configured (`type: 'global-store'`), automatically wiring Redis or Vercel KV into every tool that opts into caching.

### fix

- Rebuilt the Vercel/Lambda bundle pipeline with Rspack helpers, saner entry generation, and stronger escaping so serverless deploys ship the same assets as local builds.
- Hardened Handlebars widgets and cache providers with null-safe escaping plus stricter validation so malformed templates stop returning blank widgets.

### docs

- Added a dedicated Vercel KV guide plus callouts in the Redis and Serverless docs so edge deployments know when to reach for Redis vs KV.
- Updated the UI library guide and release notes to explain the new `@frontmcp/uipack` import paths and package split.

### build

- Raised the workspace to `@modelcontextprotocol/sdk 1.25.1`, Nx 22.3.3, new rspack/esbuild dependencies, and Snyk resolutions so installs stay reproducible on Node 24.

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

- Publish the standalone `mcp-from-openapi` generator and wire the OpenAPI adapter to it so every tool inherits conflict-free params, request mappers, and per-scheme authentication analysis.
- Allow `@Tool` metadata to declare literal primitives, tuple-style arrays, and MCP resources (plus `rawInputSchema`) so clients get typed responses without wrapping outputs in placeholder objects.
- Add a typed MCP error hierarchy and error handler so transports emit traceable IDs, consistent public/internal messages, and FlowControl-aware stop semantics.
- Extract `json-schema-to-zod-v3` with built-in regex guards so adapters and apps can reuse the hardened JSON Schema → Zod converter.

### docs

- Document OpenAPI adapter security scoring, auth-provider mapping, generator options, and the CodeCall plugin’s search/describe/execute workflow.
- Publish maintainer runbooks for the release workflow and doc versioning so contributors know when to edit draft vs live docs.

### build

- Split draft/live Mintlify trees, auto-archive previous minors, and enforce husky + lint-staged guards so release branches stay focused on intentional changes.

## FrontMCP 0.3.0?\*\*\*
