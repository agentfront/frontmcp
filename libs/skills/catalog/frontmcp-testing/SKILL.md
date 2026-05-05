---
name: frontmcp-testing
description: 'Use when you want to write tests, run tests, add e2e tests, improve test coverage, test a tool, test a resource, or learn how to test any FrontMCP component. The skill for ALL testing needs.'
tags: [router, testing, jest, e2e, coverage, quality, guide]
category: testing
targets: [all]
bundle: [recommended, full]
priority: 10
visibility: both
license: Apache-2.0
metadata:
  docs: https://docs.agentfront.dev/frontmcp/testing/overview
---

# FrontMCP Testing Router

Entry point for testing FrontMCP applications. This skill helps you navigate testing strategies across component types and find the right patterns for unit, integration, and E2E tests.

## When to Use This Skill

### Must Use

- Setting up testing infrastructure for a new FrontMCP project
- Deciding how to test a specific component type (tool, resource, prompt, agent)
- Planning a testing strategy that covers unit, E2E, and coverage requirements

### Recommended

- Looking up testing patterns for a component type you haven't tested before
- Understanding the relationship between unit tests, E2E tests, and coverage thresholds
- Troubleshooting test failures or coverage gaps

### Skip When

- You need detailed Jest configuration and test harness setup (go directly to `setup-testing`)
- You need to build components, not test them (see `frontmcp-development`)
- You need to deploy, not test (see `frontmcp-deployment`)

> **Decision:** Use this skill for testing strategy and routing. Use `setup-testing` for hands-on Jest configuration and test writing.

## Prerequisites

- A FrontMCP project with at least one component to test (see `frontmcp-development`).
- Jest installed and configured — if not, start with `setup-testing` before opening any other testing skill.
- The component itself implemented and exported; tests reach decorated classes through the SDK, not by importing internal builders.

## Steps

This is a router skill. Follow this order to pick a testing approach, then move to the target skill.

1. **Pick the test layer** — unit (fastest, mock DI), integration (real DI scope), or E2E (real MCP client + server). Use the Testing Strategy table below.
2. **Pick the component flavour** — tool / resource / prompt / agent / job — each has a distinct recipe.
3. **Pick the runtime concern** — auth, browser/CLI build, direct vs streamable transport — and add the matching skill to your reading list.
4. **Open the target skill** (e.g. `test-tool-unit`, `test-e2e-handler`, `test-auth`) and follow its Steps section.
5. **Enforce coverage** — confirm the project's 95%+ thresholds are wired into Jest before merging (see `setup-testing`).

## Scenario Routing Table

| Scenario                                | Skill / Section                 | Description                                                                                          |
| --------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Set up Jest, coverage, and test harness | `setup-testing`                 | Full Jest config, test utilities, and coverage thresholds                                            |
| Write unit tests for a tool             | `test-tool-unit`                | Mock DI, validate input/output, test error paths                                                     |
| Write unit tests for a resource         | `setup-testing` (Unit Testing)  | Test URI resolution, template params, read results                                                   |
| Write unit tests for a prompt           | `setup-testing` (Unit Testing)  | Test argument handling, message generation                                                           |
| Write E2E protocol-level tests          | `setup-testing` (E2E Testing)   | Real MCP client/server, full protocol flow                                                           |
| Test authenticated endpoints            | `test-auth`                     | E2E with OAuth tokens, session validation, role-based access                                         |
| Test deployment builds                  | `setup-testing` + `deploy-to-*` | Smoke tests against built output                                                                     |
| Test browser builds                     | `test-browser-build`            | Smoke-test a `frontmcp build --target browser` bundle (import the bundle, optional Playwright suite) |
| Test CLI binary builds                  | `test-cli-binary`               | Spawn-and-curl smoke tests for `frontmcp build --target cli` artifacts                               |
| Test with the direct API client         | `test-direct-client`            | In-memory testing via `create()`, `connectOpenAI()`, `connectClaude()` (no HTTP)                     |
| Write E2E test handler patterns         | `test-e2e-handler`              | Manual `McpTestClient` + `TestServer` E2E patterns (alternative to fixture API)                      |
| Unit test individual tools              | `test-tool-unit`                | Unit testing individual `ToolContext` subclasses with a mock context                                 |

## Testing Strategy by Component Type

| Component | Unit Test Focus                                          | E2E Test Focus                     | Key Assertions                                                          |
| --------- | -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| Tool      | Input validation, execute logic, error paths, DI mocking | `tools/call` via MCP client        | Output matches schema, errors return MCP codes                          |
| Resource  | URI resolution, read content, template param handling    | `resources/read` via MCP client    | Content type correct, URI patterns resolve                              |
| Prompt    | Argument validation, message generation, multi-turn      | `prompts/get` via MCP client       | Messages match expected structure                                       |
| Agent     | LLM config, tool selection, handoff logic                | Agent loop via MCP client          | Tools called in order, result synthesized                               |
| Provider  | Lifecycle hooks, factory output, singleton behavior      | Indirectly via tool/resource tests | Instance reuse, cleanup on scope disposal                               |
| Job       | Progress tracking, retry logic, attempt counting         | Job execution via test harness     | Progress events emitted, retries respected                              |
| Workflow  | Step dependencies, conditions, input mapping functions   | Workflow run via test harness      | Steps execute in order, conditions evaluated, continueOnError respected |
| Skill     | Instruction loading (inline/file/url), tool validation   | Skill discovery via MCP/HTTP       | Instructions resolve, tool refs validated per `toolValidation` mode     |
| Plugin    | Context extensions, provider registration, hook firing   | Indirectly via tool tests          | Extensions available on `this`, hooks fire at correct stages            |

## Cross-Cutting Testing Patterns

| Pattern            | Rule                                                                                                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File naming        | Always `.spec.ts` (not `.test.ts`); E2E uses `.e2e.spec.ts`                                                                                                                                                                                                                                          |
| File organization  | Split E2E tests by app/feature: `e2e/calc.e2e.spec.ts`, `e2e/ecommerce.e2e.spec.ts`. Never put all tests in a single `server.e2e.spec.ts`                                                                                                                                                            |
| Test runner        | Standalone projects: use `frontmcp test` (auto-generates Jest/SWC config). Nx monorepos: use `nx test <lib>` (resolves the project's `jest.config.ts`). Never invoke `jest --config ...` directly                                                                                                    |
| Coverage threshold | 95%+ across statements, branches, functions, lines                                                                                                                                                                                                                                                   |
| Test descriptions  | Plain English, no prefixes like "PT-001"; describe behavior not implementation                                                                                                                                                                                                                       |
| Mocking            | Mock providers via DI token replacement, never mock the framework                                                                                                                                                                                                                                    |
| httpMock scope     | `httpMock` intercepts HTTP in the **test process** only, NOT in the MCP server subprocess. Do not use httpMock to intercept server-to-API calls — those happen in the child process. Use httpMock for verifying client-to-server request shapes or mocking external APIs called from the test itself |
| Error testing      | Assert `instanceof` specific error class AND MCP error code                                                                                                                                                                                                                                          |
| Async              | Always `await` async operations; use `expect(...).rejects.toThrow()` for async errors                                                                                                                                                                                                                |

## Common Patterns

| Pattern            | Correct                                                       | Incorrect                                    | Why                                                                   |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| Test file location | `fetch-weather.tool.spec.ts` next to source                   | `__tests__/fetch-weather.test.ts`            | Co-location with `.spec.ts` extension matches FrontMCP conventions    |
| DI mocking         | Replace token with mock via `scope.register(TOKEN, mockImpl)` | `jest.mock('../provider')` module mock       | DI mocking is cleaner, type-safe, and tests the real integration path |
| Error assertions   | `expect(err).toBeInstanceOf(ResourceNotFoundError)`           | `expect(err.message).toContain('not found')` | Class checks are stable; message strings are fragile                  |
| E2E transport      | Use `@frontmcp/testing` MCP client with real server           | HTTP requests with `fetch`                   | The test client handles protocol details (session, framing)           |
| Coverage gaps      | Investigate uncovered branches, add targeted tests            | Add `istanbul ignore` comments               | Coverage gaps often hide real bugs; ignoring them defeats the purpose |

## Verification Checklist

### Infrastructure

- [ ] Jest configured with `@frontmcp/testing` preset
- [ ] Coverage thresholds set to 95% in jest.config
- [ ] Test files use `.spec.ts` extension throughout

### Unit Tests

- [ ] Each tool has unit tests covering happy path, validation errors, and DI failures
- [ ] Each resource has unit tests covering URI resolution and read content
- [ ] Provider lifecycle (init, dispose) tested where applicable

### E2E Tests

- [ ] At least one E2E test exercises full MCP protocol flow (connect, list, call, disconnect)
- [ ] Authenticated E2E tests use proper test tokens (not mocked auth)
- [ ] E2E tests clean up state after execution

### CI Integration

- [ ] Tests run in CI pipeline on every PR
- [ ] Coverage report published and enforced
- [ ] Failing tests block merge

## Troubleshooting

| Problem                            | Cause                                                   | Solution                                                                               |
| ---------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Jest not finding test files        | Wrong file extension (`.test.ts` instead of `.spec.ts`) | Rename to `.spec.ts`; check `testMatch` in jest.config                                 |
| Coverage below 95%                 | Untested error paths or conditional branches            | Run `frontmcp test --coverage` and inspect uncovered lines in the report               |
| E2E test timeout                   | Server startup too slow or port conflict                | Increase Jest timeout; use random port allocation                                      |
| DI resolution fails in tests       | Provider not registered in test scope                   | Register mock providers before creating the test context                               |
| Istanbul shows 0% on async methods | TypeScript source-map mismatch with Istanbul            | Known issue with some TS compilation settings; verify coverage with actual test output |

## Examples

Each reference has matching examples under [`examples/<reference>/`](./examples/):

### `setup-testing`

| Example                                                                                        | Level        | Description                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`fixture-based-e2e-test`](./examples/setup-testing/fixture-based-e2e-test.md)                 | Advanced     | Write E2E tests using the fixture API from `@frontmcp/testing` that manages server lifecycle automatically and uses MCP-specific custom matchers. |
| [`jest-config-with-coverage`](./examples/setup-testing/jest-config-with-coverage.md)           | Basic        | Set up a Jest configuration file that enforces 95%+ coverage across all metrics for a FrontMCP library.                                           |
| [`unit-test-tool-resource-prompt`](./examples/setup-testing/unit-test-tool-resource-prompt.md) | Intermediate | Write unit tests for the three core MCP primitives, verifying that outputs match the expected MCP response shapes.                                |

### `test-auth`

| Example                                                                    | Level        | Description                                                                                               |
| -------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| [`oauth-flow-test`](./examples/test-auth/oauth-flow-test.md)               | Advanced     | Use `MockOAuthServer` to simulate an OAuth identity provider and test the authorization code flow.        |
| [`role-based-access-test`](./examples/test-auth/role-based-access-test.md) | Intermediate | Verify that tools enforce role-based access by testing admin and user tokens against protected endpoints. |
| [`token-factory-test`](./examples/test-auth/token-factory-test.md)         | Basic        | Use `TestTokenFactory` to create tokens and verify authenticated and unauthenticated requests.            |

### `test-browser-build`

| Example                                                                                   | Level    | Description                                                                                      |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| [`browser-bundle-validation`](./examples/test-browser-build/browser-bundle-validation.md) | Basic    | Verify that the browser build produces a valid bundle without Node.js-only module references.    |
| [`playwright-browser-test`](./examples/test-browser-build/playwright-browser-test.md)     | Advanced | Use Playwright to test a browser-based MCP client that loads and calls tools from an MCP server. |

### `test-cli-binary`

| Example                                                                        | Level        | Description                                                                                                        |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------ |
| [`binary-startup-test`](./examples/test-cli-binary/binary-startup-test.md)     | Basic        | Verify that a compiled CLI binary starts correctly and responds to health checks.                                  |
| [`js-bundle-import-test`](./examples/test-cli-binary/js-bundle-import-test.md) | Intermediate | Verify that the compiled JS bundle can be imported and exports the expected modules after a `frontmcp build` step. |

### `test-direct-client`

| Example                                                                                   | Level        | Description                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| [`basic-create-test`](./examples/test-direct-client/basic-create-test.md)                 | Basic        | Test tools in-memory without any HTTP overhead using the `create()` function from `@frontmcp/sdk`.                            |
| [`openai-claude-format-test`](./examples/test-direct-client/openai-claude-format-test.md) | Intermediate | Verify that tools are returned in the correct format for OpenAI and Claude clients using `connectOpenAI` and `connectClaude`. |

### `test-e2e-handler`

| Example                                                                                       | Level        | Description                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| [`basic-e2e-test`](./examples/test-e2e-handler/basic-e2e-test.md)                             | Basic        | Set up a basic E2E test that starts a server, connects a client, and verifies tools are listed.                      |
| [`manual-client-with-transport`](./examples/test-e2e-handler/manual-client-with-transport.md) | Advanced     | Use `McpTestClient.create()` with explicit transport settings for fine-grained control over E2E tests.               |
| [`tool-call-and-error-e2e`](./examples/test-e2e-handler/tool-call-and-error-e2e.md)           | Intermediate | Test successful tool calls and verify that invalid inputs produce proper error responses over the full MCP protocol. |

### `test-tool-unit`

| Example                                                                             | Level        | Description                                                                                              |
| ----------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| [`basic-tool-test`](./examples/test-tool-unit/basic-tool-test.md)                   | Basic        | Test a simple tool's `execute()` method with mock context and verify the output.                         |
| [`schema-validation-test`](./examples/test-tool-unit/schema-validation-test.md)     | Intermediate | Validate that a tool's Zod input schema rejects invalid data before `execute()` is called.               |
| [`tool-error-handling-test`](./examples/test-tool-unit/tool-error-handling-test.md) | Advanced     | Test that a tool throws the correct MCP error classes with proper error codes and JSON-RPC error shapes. |

## Accessing This Skill

Skills are distributed as plain SKILL.md files plus a sibling `references/`
and `examples/` tree, so consumers can pick whichever access mode fits:

| Mode               | How it works                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Filesystem**     | Read `libs/skills/catalog/frontmcp-testing/` directly from a clone of the catalog repo, or from a published `@frontmcp/skills` install. SKILL.md is the entry point.                                                                                                                                                                              |
| **`frontmcp` CLI** | `frontmcp skills list`, `frontmcp skills read frontmcp-testing`, `frontmcp skills read frontmcp-testing:references/<file>.md`, `frontmcp skills install frontmcp-testing` — no server required.                                                                                                                                                   |
| **MCP `skill://`** | When a developer mounts this skill into their own FrontMCP server (`@FrontMcp({ skills: [...] })`), the SDK exposes it via SEP-2640 resources: `skill://frontmcp-testing/SKILL.md`, `skill://frontmcp-testing/references/{file}.md`, etc. The server’s `skill://index.json` returns the SEP-2640 discovery document for everything mounted on it. |

The catalog itself is **not** an MCP server. The `skill://` URIs only resolve
when a server has been configured to host this skill.

## Reference

- [Testing Documentation](https://docs.agentfront.dev/frontmcp/testing/overview)
- Related skills: `setup-testing`, `create-tool`, `create-resource`, `create-prompt`, `configure-auth`
